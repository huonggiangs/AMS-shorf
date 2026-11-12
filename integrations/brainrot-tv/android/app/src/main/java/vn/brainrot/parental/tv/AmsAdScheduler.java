package vn.brainrot.parental.tv;

import android.content.Context;
import android.net.ConnectivityManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Calendar;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

/**
 * Chooses which creative may be shown now and keeps the media cache consistent with the manifest.
 *
 * Selection (docs/DEVICE-PROTOCOL.md section 7.1, plus the client rules in docs/TV-APP-INTEGRATION.md section 6):
 *  1. slots whose [start_min, end_min) contains the local time in manifest.tz (always Asia/Ho_Chi_Minh today);
 *  2. lower `priority` number wins; the same priority rotates, least recently shown first;
 *  3. inside a slot, among creative_ids that are renderable here, take the largest px_w not above the screen width,
 *     else the smallest;
 *  4. pacing: global minimum gap and an hourly cap well below the server's 120 valid impressions/device/hour.
 * A creative is renderable only if it is an image with a valid overlay for the requested context, is kid_safe when
 * the context is "lock", and its verified file is in the cache. Videos and unsupported formats are skipped
 * (the app bundles no media player), and never downloaded.
 *
 * Cache: content-addressed by sha256 in files/ams/cache, downloaded to .part (Range resume) and renamed only after
 * the sha256 and size match; files not referenced by the current or the previous manifest are deleted.
 */
final class AmsAdScheduler {
    static final String MANIFEST_TZ = "Asia/Ho_Chi_Minh";
    static final long MAX_STALE_MS = 24L * 3600_000L;

    static final class Config {
        int screenWidthPx = 1920;
        int maxPerHour = 30;                 // child-facing surface: far below the server cap of 120
        long minGapMs = 60_000L;             // gap between two ads, any creative
        long perCreativeGapMs = 5 * 60_000L;
        long cacheLimitBytes = 200L * 1024 * 1024;
        long freeSpaceReserveBytes = 256L * 1024 * 1024;
        List<String> mediaHostSuffixes = Arrays.asList("anio.vn");   // allow-list; confirm the real CDN host with f2
        boolean skipMeteredNetwork = true;
    }

    /** One renderable choice. */
    static final class Pick {
        final String creativeId, campaignId, slotId, context;
        final JSONObject creative;
        final AmsOverlaySpec spec;
        final File file;
        final long durationMs;
        final int priority, rewardPoints;

        Pick(String creativeId, String campaignId, String slotId, String context, JSONObject creative, AmsOverlaySpec spec,
             File file, long durationMs, int priority, int rewardPoints) {
            this.creativeId = creativeId; this.campaignId = campaignId; this.slotId = slotId; this.context = context;
            this.creative = creative; this.spec = spec; this.file = file; this.durationMs = durationMs;
            this.priority = priority; this.rewardPoints = rewardPoints;
        }
    }

    private static final class Need {
        final String sha, url; final long size;
        Need(String sha, String url, long size) { this.sha = sha; this.url = url; this.size = size; }
    }

    private final Context ctx;
    private final File cacheDir;
    private final Config cfg;
    private JSONObject manifest;
    private JSONObject previous;
    private long manifestAtMs;
    private final Map<String, Long> lastShown = new HashMap<>();
    private final ArrayDeque<Long> shows = new ArrayDeque<>();
    private long lastAnyShow;
    private final Map<String, Integer> shaFailures = new HashMap<>();
    private final Set<String> badSha = new HashSet<>();

    AmsAdScheduler(Context ctx, File baseDir, Config cfg) {
        this.ctx = ctx;
        this.cfg = cfg;
        this.cacheDir = new File(baseDir, "cache");
        //noinspection ResultOfMethodCallIgnored
        cacheDir.mkdirs();
    }

    // ---------- manifest state ----------

    synchronized void adopt(JSONObject newManifest, long fetchedAtMs) {
        if (manifest != null && newManifest != manifest) previous = manifest;
        manifest = newManifest;
        manifestAtMs = fetchedAtMs;
    }

    synchronized void touch(long fetchedAtMs) { manifestAtMs = fetchedAtMs; }    // 304 Not Modified keeps the manifest fresh

    synchronized JSONObject manifest() { return manifest; }

    /** Applies delta {creatives_added, creatives_removed, schedule(full), etag, group, tz...} on top of base (section 7.2). */
    static JSONObject mergeDelta(JSONObject base, JSONObject delta) throws Exception {
        JSONObject out = new JSONObject();
        out.put("version", delta.optInt("version", base.optInt("version", 1)));
        out.put("group", delta.optString("group", base.optString("group", "")));
        out.put("tz", delta.optString("tz", base.optString("tz", MANIFEST_TZ)));
        out.put("etag", delta.optString("etag", ""));
        out.put("generated_at", delta.optString("generated_at", ""));
        out.put("ttl_s", delta.optInt("ttl_s", base.optInt("ttl_s", 900)));
        Set<String> removed = new HashSet<>();
        JSONArray rm = delta.optJSONArray("creatives_removed");
        if (rm != null) for (int i = 0; i < rm.length(); i++) removed.add(rm.optString(i));
        Map<String, JSONObject> merged = new LinkedHashMap<>();
        JSONArray old = base.optJSONArray("creatives");
        if (old != null) for (int i = 0; i < old.length(); i++) {
            JSONObject c = old.optJSONObject(i);
            if (c != null && !removed.contains(c.optString("id"))) merged.put(c.optString("id"), c);
        }
        JSONArray add = delta.optJSONArray("creatives_added");
        if (add != null) for (int i = 0; i < add.length(); i++) {
            JSONObject c = add.optJSONObject(i);
            if (c != null) merged.put(c.optString("id"), c);
        }
        JSONArray creatives = new JSONArray();
        for (JSONObject c : merged.values()) creatives.put(c);
        out.put("creatives", creatives);
        out.put("schedule", delta.optJSONArray("schedule") == null ? new JSONArray() : delta.optJSONArray("schedule"));
        return out;
    }

    /** True if every creative id used by the schedule exists in creatives (otherwise refetch the full manifest). */
    static boolean consistent(JSONObject m) {
        Set<String> ids = new HashSet<>();
        JSONArray cs = m.optJSONArray("creatives");
        if (cs != null) for (int i = 0; i < cs.length(); i++) ids.add(cs.optJSONObject(i) == null ? "" : cs.optJSONObject(i).optString("id"));
        JSONArray sc = m.optJSONArray("schedule");
        if (sc != null) for (int i = 0; i < sc.length(); i++) {
            JSONObject slot = sc.optJSONObject(i);
            JSONArray refs = slot == null ? null : slot.optJSONArray("creative_ids");
            if (refs != null) for (int j = 0; j < refs.length(); j++) if (!ids.contains(refs.optString(j))) return false;
        }
        return true;
    }

    // ---------- selection ----------

    synchronized boolean mayShow(long nowMs) {
        if (manifest == null || nowMs - manifestAtMs > MAX_STALE_MS && manifestAtMs > 0) return false;
        if (nowMs - lastAnyShow < cfg.minGapMs) return false;
        while (!shows.isEmpty() && nowMs - shows.peekFirst() > 3600_000L) shows.pollFirst();
        return shows.size() < cfg.maxPerHour;
    }

    /** Best renderable creative for the context, without recording a show. Null when nothing is eligible. */
    synchronized Pick peek(String context, long nowMs) {
        if (!mayShow(nowMs)) return null;
        JSONObject m = manifest;
        Map<String, JSONObject> byId = creativesById(m);
        JSONArray schedule = m.optJSONArray("schedule");
        if (schedule == null) return null;
        int minutes = localMinutes(m.optString("tz", MANIFEST_TZ), nowMs);
        Pick best = null;
        for (int i = 0; i < schedule.length(); i++) {
            JSONObject slot = schedule.optJSONObject(i);
            if (slot == null) continue;
            if (minutes < slot.optInt("start_min", 0) || minutes >= slot.optInt("end_min", 1440)) continue;
            Pick p = pickFromSlot(slot, byId, context, nowMs);
            if (p != null && better(p, best, nowMs)) best = p;
        }
        return best;
    }

    synchronized void commit(Pick p, long nowMs) {
        lastShown.put(p.creativeId, nowMs);
        lastAnyShow = nowMs;
        shows.addLast(nowMs);
    }

    private boolean better(Pick p, Pick cur, long now) {
        if (cur == null) return true;
        if (p.priority != cur.priority) return p.priority < cur.priority;           // smaller number = higher priority
        return lastShown.getOrDefault(p.creativeId, 0L) < lastShown.getOrDefault(cur.creativeId, 0L);
    }

    private Pick pickFromSlot(JSONObject slot, Map<String, JSONObject> byId, String context, long nowMs) {
        JSONArray refs = slot.optJSONArray("creative_ids");
        if (refs == null) return null;
        JSONObject chosen = null;
        AmsOverlaySpec chosenSpec = null;
        for (int i = 0; i < refs.length(); i++) {
            JSONObject c = byId.get(refs.optString(i));
            if (c == null) continue;
            AmsOverlaySpec spec = renderable(c, context);
            if (spec == null) continue;
            if (nowMs - lastShown.getOrDefault(c.optString("id"), 0L) < cfg.perCreativeGapMs) continue;
            if (chosen == null || betterResolution(c, chosen)) { chosen = c; chosenSpec = spec; }
        }
        if (chosen == null) return null;
        long durationS = chosen.isNull("duration_s") ? chosenSpec.durationS : chosen.optLong("duration_s", chosenSpec.durationS);
        if (durationS < 1) durationS = chosenSpec.durationS;
        return new Pick(chosen.optString("id"), chosen.optString("campaign_id"), slot.optString("slot_id", ""), context, chosen,
            chosenSpec, fileFor(chosenSpec.bgSha256), durationS * 1000L, slot.optInt("priority", 99), slot.optInt("reward_points", 0));
    }

    /** Largest px_w not above the screen width; if all are larger, the smallest (DEVICE-PROTOCOL 7.1). */
    private boolean betterResolution(JSONObject cand, JSONObject cur) {
        int w = cfg.screenWidthPx, a = cand.optInt("px_w", 0), b = cur.optInt("px_w", 0);
        boolean aFits = a <= w, bFits = b <= w;
        if (aFits != bFits) return aFits;
        return aFits ? a > b : a < b;
    }

    /** The overlay spec if this creative can be rendered in the context right now, else null. */
    private AmsOverlaySpec renderable(JSONObject c, String context) {
        if (!"image".equals(c.optString("media_type"))) return null;
        String format = c.optString("format", "fullscreen");
        boolean formatOk = AmsOverlaySpec.CTX_PAUSE.equals(context) ? "pause_ad".equals(format)
            : AmsOverlaySpec.CTX_CORNER.equals(context) ? "qr_corner".equals(format) : "fullscreen".equals(format);
        if (!formatOk) return null;
        JSONObject overlay = c.optJSONObject("overlay");
        if (overlay == null) return null;
        AmsOverlaySpec spec;
        try { spec = AmsOverlaySpec.parse(overlay, c); } catch (IllegalArgumentException invalid) { return null; }
        if (!spec.allows(context)) return null;
        if (AmsOverlaySpec.CTX_LOCK.equals(context) && !spec.kidSafe) return null;     // not approved for a child-facing screen
        if (badSha.contains(spec.bgSha256) || !fileFor(spec.bgSha256).isFile()) return null;
        return spec;
    }

    private static Map<String, JSONObject> creativesById(JSONObject m) {
        Map<String, JSONObject> map = new HashMap<>();
        JSONArray cs = m.optJSONArray("creatives");
        if (cs != null) for (int i = 0; i < cs.length(); i++) {
            JSONObject c = cs.optJSONObject(i);
            if (c != null) map.put(c.optString("id"), c);
        }
        return map;
    }

    static int localMinutes(String tz, long nowMs) {
        Calendar cal = Calendar.getInstance(TimeZone.getTimeZone(tz));
        cal.setTimeInMillis(nowMs);
        return cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE);
    }

    // ---------- cache ----------

    File fileFor(String sha) { return new File(cacheDir, sha + ".bin"); }

    synchronized long cacheBytes() {
        long total = 0;
        File[] files = cacheDir.listFiles();
        if (files != null) for (File f : files) if (f.getName().endsWith(".bin")) total += f.length();
        return total;
    }

    synchronized int cacheFiles() {
        String[] names = cacheDir.list((d, n) -> n.endsWith(".bin"));
        return names == null ? 0 : names.length;
    }

    /**
     * Downloads and verifies every renderable creative of {@code m} that is not cached yet. Blocking; call from the worker thread.
     * @return true when nothing renderable is still missing (a creative that failed sha256 three times is dropped, not awaited).
     */
    boolean prefetch(JSONObject m, long deadlineWallMs) {
        boolean complete = true;
        for (Need n : needs(m)) {
            if (fileFor(n.sha).isFile() || badSha.contains(n.sha)) continue;
            if (System.currentTimeMillis() > deadlineWallMs) return false;
            if (!hostAllowed(n.url)) { badSha.add(n.sha); continue; }
            if (cfg.skipMeteredNetwork && metered()) { complete = false; continue; }
            if (!roomFor(n.size)) { complete = false; continue; }
            if (!download(n)) complete = badSha.contains(n.sha) && complete;
        }
        return complete;
    }

    /** Delete cached files that neither the current nor the previous nor {@code staged} manifest references (and stale .part files). */
    void purge(JSONObject staged) {
        Set<String> keep = new HashSet<>();
        JSONObject cur, prev;
        synchronized (this) { cur = manifest; prev = previous; }
        for (JSONObject m : new JSONObject[] {cur, prev, staged}) if (m != null) for (Need n : needs(m)) keep.add(n.sha);
        File[] files = cacheDir.listFiles();
        if (files == null) return;
        long now = System.currentTimeMillis();
        for (File f : files) {
            String name = f.getName();
            if (name.endsWith(".bin") && !keep.contains(name.substring(0, name.length() - 4))) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            } else if (name.endsWith(".part") && now - f.lastModified() > 24L * 3600_000L) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
    }

    private List<Need> needs(JSONObject m) {
        Map<String, Need> out = new LinkedHashMap<>();
        Set<String> referenced = new HashSet<>();
        JSONArray schedule = m.optJSONArray("schedule");
        if (schedule != null) for (int i = 0; i < schedule.length(); i++) {
            JSONObject slot = schedule.optJSONObject(i);
            JSONArray refs = slot == null ? null : slot.optJSONArray("creative_ids");
            if (refs != null) for (int j = 0; j < refs.length(); j++) referenced.add(refs.optString(j));
        }
        JSONArray cs = m.optJSONArray("creatives");
        if (cs != null) for (int i = 0; i < cs.length(); i++) {
            JSONObject c = cs.optJSONObject(i);
            if (c == null || !referenced.contains(c.optString("id")) || !"image".equals(c.optString("media_type"))) continue;
            JSONObject overlay = c.optJSONObject("overlay");
            if (overlay == null) continue;
            try {
                AmsOverlaySpec s = AmsOverlaySpec.parse(overlay, c);
                long size = s.bgSha256.equals(c.optString("sha256")) ? c.optLong("size_bytes", 0L) : 0L;
                out.putIfAbsent(s.bgSha256, new Need(s.bgSha256, s.bgUrl, size));
            } catch (IllegalArgumentException invalid) { /* never downloaded, never shown */ }
        }
        return new java.util.ArrayList<>(out.values());
    }

    private boolean hostAllowed(String url) {
        try {
            URL u = new URL(url);
            if (!"https".equals(u.getProtocol())) return false;
            String host = u.getHost().toLowerCase(java.util.Locale.ROOT);
            for (String suffix : cfg.mediaHostSuffixes) {
                String s = suffix.toLowerCase(java.util.Locale.ROOT);
                if (host.equals(s) || host.endsWith("." + s)) return true;
            }
        } catch (Exception ignored) { /* malformed */ }
        return false;
    }

    private boolean metered() {
        try {
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            return cm != null && cm.isActiveNetworkMetered();
        } catch (Exception e) { return false; }
    }

    private boolean roomFor(long size) {
        long need = size > 0 ? size : 12L * 1024 * 1024;
        return cacheBytes() + need <= cfg.cacheLimitBytes && cacheDir.getUsableSpace() - need >= cfg.freeSpaceReserveBytes;
    }

    private boolean download(Need n) {
        File part = new File(cacheDir, n.sha + ".part");
        long limit = n.size > 0 ? n.size : 12L * 1024 * 1024;
        HttpURLConnection conn = null;
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            long have = part.isFile() ? part.length() : 0L;
            if (have > limit) { part.delete(); have = 0; }
            conn = (HttpURLConnection) new URL(n.url).openConnection();
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(30_000);
            if (have > 0) conn.setRequestProperty("Range", "bytes=" + have + "-");
            int code = conn.getResponseCode();
            if (!hostAllowed(conn.getURL().toString())) { badSha.add(n.sha); return false; }  // redirected off the allow-list
            if (code == 200) { have = 0; part.delete(); }
            else if (code != 206) return false;
            if (have > 0) rehash(part, md);
            long total = have;
            try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(part, have > 0)) {
                byte[] buf = new byte[16 * 1024];
                int r;
                while ((r = in.read(buf)) > 0) {
                    total += r;
                    if (total > limit) { part.delete(); return false; }
                    md.update(buf, 0, r);
                    out.write(buf, 0, r);
                }
                out.getFD().sync();
            }
            String actual = AmsClient.hex(md.digest());
            boolean sizeOk = n.size <= 0 || total == n.size;
            if (!actual.equals(n.sha) || !sizeOk) {
                part.delete();
                int fails = shaFailures.merge(n.sha, 1, Integer::sum);
                if (fails >= 3) badSha.add(n.sha);          // stop waiting for a corrupt/mismatching file
                return false;
            }
            File dst = fileFor(n.sha);
            if (!part.renameTo(dst)) return false;
            //noinspection ResultOfMethodCallIgnored
            dst.setLastModified(System.currentTimeMillis());
            return true;
        } catch (Exception e) {
            return false;                                    // network error: keep .part for Range resume
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static void rehash(File part, MessageDigest md) throws Exception {
        try (InputStream in = new FileInputStream(part)) {
            byte[] buf = new byte[16 * 1024];
            int r;
            while ((r = in.read(buf)) > 0) md.update(buf, 0, r);
        }
    }
}
