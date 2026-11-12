package vn.brainrot.parental.tv;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Measures real on-screen time of one ad at a time and keeps a durable, ordered queue of impression events.
 *
 * Counting rules (docs/TV-APP-INTEGRATION.md section 6):
 *  - time accumulates only while no blocker is set (screen off, window detached, ad zone covered, ...);
 *  - an impression is queued only when visible time >= duration (so vcr_pct is exactly 100, the server default
 *    threshold IMPRESSION_MIN_VCR=100) -- partial plays are counted locally and dropped, never sent as valid;
 *  - event_id is a UUIDv7 generated when the play ends and persisted (fsync) BEFORE any network attempt;
 *  - events older than 47 h are discarded locally (server rejects > 48 h as ts_out_of_range).
 * Thread-safety: all public methods are synchronized; the clock is injectable for tests.
 */
final class AmsImpressionTracker {
    interface Ticker { long elapsedMs(); long wallMs(); }

    static final int MAX_BATCH = 50;
    static final int MAX_BATCH_BYTES = 15_000;         // gateway hard limit is 16 KB
    static final int MAX_QUEUE = 4000;
    static final long MAX_AGE_MS = 47L * 3600_000L;
    private static final SecureRandom RNG = new SecureRandom();

    /** Result of finishing a play. */
    static final class Outcome {
        final boolean queued; final int vcrPct; final long visibleMs; final String reason; final String eventId;
        Outcome(boolean queued, int vcrPct, long visibleMs, String reason, String eventId) {
            this.queued = queued; this.vcrPct = vcrPct; this.visibleMs = visibleMs; this.reason = reason; this.eventId = eventId;
        }
    }

    private final File queueFile;
    private final Ticker ticker;
    private final Set<String> blockers = new HashSet<>();

    // current play
    private boolean active;
    private String campaignId = "", creativeId = "", slotId = "", placement = "";
    private long durationMs;
    private long visibleMs;
    private long lastTickMs;
    private long beganWallMs;

    // local counters (diagnostics, shown by "Ad Diagnostics" if the UI wants them)
    private int droppedPartial, queuedTotal, droppedExpired;

    AmsImpressionTracker(File dir, Ticker ticker) {
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        this.queueFile = new File(dir, "events.queue");
        this.ticker = ticker;
    }

    // ---------- play lifecycle ----------

    synchronized void begin(String campaignId, String creativeId, String slotId, String placement, long durationMs) {
        if (active) end("superseded");
        this.active = true;
        this.campaignId = campaignId; this.creativeId = creativeId; this.slotId = slotId == null ? "" : slotId;
        this.placement = placement; this.durationMs = Math.max(1000L, durationMs);
        this.visibleMs = 0;
        this.lastTickMs = ticker.elapsedMs();
        this.beganWallMs = ticker.wallMs();
    }

    synchronized void block(String reason) {
        accumulate();
        blockers.add(reason);
    }

    synchronized void unblock(String reason) {
        accumulate();
        blockers.remove(reason);
    }

    synchronized void setBlocked(String reason, boolean blocked) { if (blocked) block(reason); else unblock(reason); }

    synchronized boolean isActive() { return active; }

    synchronized long visibleMs() { accumulate(); return visibleMs; }

    synchronized long remainingMs() { accumulate(); return Math.max(0L, durationMs - visibleMs); }

    /** Finish the current play. Queues an impression only for a full, uninterrupted-enough view (visible >= duration). */
    synchronized Outcome end(String reason) {
        if (!active) return new Outcome(false, 0, 0, "inactive", "");
        accumulate();
        active = false;
        long played = Math.min(visibleMs, 3_600_000L);
        int vcr = (int) Math.min(100L, (visibleMs * 100L) / durationMs);
        if (visibleMs < durationMs) {
            droppedPartial++;
            return new Outcome(false, vcr, visibleMs, reason, "");
        }
        long endWall = ticker.wallMs();
        String id = uuidV7(endWall);
        try {
            JSONObject e = new JSONObject();
            e.put("type", "impression");
            e.put("event_id", id);
            e.put("ts", AmsClient.isoUtc(endWall));
            e.put("campaign_id", campaignId);
            e.put("creative_id", creativeId);
            if (!slotId.isEmpty()) e.put("slot_id", slotId);
            e.put("vcr_pct", 100);
            e.put("played_ms", (int) played);
            e.put("ctx", placement);             // extra field: ignored by the gateway today (non-strict zod); see requests
            appendDurable(e.toString());
            queuedTotal++;
            return new Outcome(true, 100, visibleMs, reason, id);
        } catch (Exception io) {
            return new Outcome(false, vcr, visibleMs, "persist_failed", "");
        }
    }

    private void accumulate() {
        long now = ticker.elapsedMs();
        if (active && blockers.isEmpty()) visibleMs += Math.max(0L, now - lastTickMs);
        lastTickMs = now;
    }

    // ---------- durable queue ----------

    synchronized int pending() { return readLines().size(); }

    /** Oldest-first batch: <= 50 events and <= 15,000 bytes. Returns the raw JSON lines (never mutates the queue). */
    synchronized List<String> peekBatch() {
        List<String> all = readLines();
        List<String> out = new ArrayList<>();
        int bytes = 16;
        for (String line : all) {
            int add = line.getBytes(StandardCharsets.UTF_8).length + 1;
            if (out.size() >= MAX_BATCH || bytes + add > MAX_BATCH_BYTES) break;
            out.add(line);
            bytes += add;
        }
        return out;
    }

    /** Remove events that the server answered for (202: accepted or permanently rejected) or that are permanently invalid. */
    synchronized void ack(List<String> sent) {
        if (sent.isEmpty()) return;
        Set<String> gone = new HashSet<>(sent);
        List<String> keep = new ArrayList<>();
        for (String line : readLines()) if (!gone.contains(line)) keep.add(line);
        rewrite(keep);
    }

    static String batchBody(List<String> lines) {
        JSONArray arr = new JSONArray();
        try { for (String l : lines) arr.put(new JSONObject(l)); } catch (Exception e) { throw new IllegalStateException(e); }
        try { return new JSONObject().put("events", arr).toString(); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    synchronized int droppedPartial() { return droppedPartial; }
    synchronized int queuedTotal() { return queuedTotal; }
    synchronized int droppedExpired() { return droppedExpired; }

    private void appendDurable(String line) throws Exception {
        List<String> existing = readLines();                              // also purges events older than 47 h
        if (existing.size() >= MAX_QUEUE) {                               // oldest-first drop when the TV stays offline for days
            rewrite(new ArrayList<>(existing.subList(existing.size() - MAX_QUEUE + 1, existing.size())));
        }
        try (FileOutputStream out = new FileOutputStream(queueFile, true)) {
            out.write((line + "\n").getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        }
    }

    private List<String> readLines() {
        List<String> lines = new ArrayList<>();
        if (!queueFile.isFile()) return lines;
        long cutoff = ticker.wallMs() - MAX_AGE_MS;
        boolean dirty = false;
        try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(queueFile), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                if (line.isEmpty()) { dirty = true; continue; }
                long ts = 0;
                try { ts = AmsClient.parseIsoMs(new JSONObject(line).optString("ts", "")); } catch (Exception corrupt) { /* drop */ }
                if (ts <= 0 || ts < cutoff) { droppedExpired++; dirty = true; continue; }
                lines.add(line);
            }
        } catch (Exception unreadable) { return lines; }
        if (dirty) rewrite(lines);
        return lines;
    }

    private void rewrite(List<String> lines) {
        File tmp = new File(queueFile.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            for (String l : lines) out.write((l + "\n").getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (Exception e) { return; }
        //noinspection ResultOfMethodCallIgnored
        tmp.renameTo(queueFile);
    }

    // ---------- UUIDv7 (RFC 9562): 48-bit unix ms | ver 7 | 74 random bits | variant 10 ----------

    static String uuidV7(long unixMs) {
        byte[] b = new byte[16];
        RNG.nextBytes(b);
        b[0] = (byte) (unixMs >>> 40); b[1] = (byte) (unixMs >>> 32); b[2] = (byte) (unixMs >>> 24);
        b[3] = (byte) (unixMs >>> 16); b[4] = (byte) (unixMs >>> 8); b[5] = (byte) unixMs;
        b[6] = (byte) ((b[6] & 0x0F) | 0x70);
        b[8] = (byte) ((b[8] & 0x3F) | 0x80);
        String h = AmsClient.hex(b);
        return h.substring(0, 8) + "-" + h.substring(8, 12) + "-" + h.substring(12, 16) + "-" + h.substring(16, 20) + "-" + h.substring(20);
    }
}
