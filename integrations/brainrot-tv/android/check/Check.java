package vn.brainrot.parental.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Resources;
import android.util.DisplayMetrics;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * JVM self-check for the reference client. NOT an Android test: android.* is replaced by the stubs in check/stubs
 * (they only compile and return defaults), so this verifies the pure logic only: signing against the published
 * vectors, overlay validation, impression counting, scheduling, manifest delta merge, and (optional) a live run
 * against a local edge-gateway: java ... Check http://127.0.0.1:18788
 */
public final class Check {
    static int failures, passed;

    static void ok(boolean cond, String what) {
        if (cond) { passed++; System.out.println("  ok   " + what); }
        else { failures++; System.out.println("  FAIL " + what); }
    }

    /** In-memory Context: prefs map + a temp directory. */
    static final class StubContext extends Context {
        final Map<String, Object> store = new HashMap<>();
        final File dir;
        StubContext(File dir) { this.dir = dir; }
        @Override public SharedPreferences getSharedPreferences(String name, int mode) { return new Prefs(store); }
        @Override public Context getApplicationContext() { return this; }
        @Override public File getFilesDir() { return dir; }
        @Override public File getNoBackupFilesDir() { return dir; }
        @Override public PackageManager getPackageManager() { return null; }
        @Override public String getPackageName() { return "vn.brainrot.parental"; }
        @Override public Resources getResources() { return null; }
        @Override public Object getSystemService(String name) { return null; }
    }

    static final class Prefs implements SharedPreferences {
        final Map<String, Object> m;
        Prefs(Map<String, Object> m) { this.m = m; }
        public String getString(String k, String d) { Object v = m.get(k); return v instanceof String ? (String) v : d; }
        public long getLong(String k, long d) { Object v = m.get(k); return v instanceof Long ? (Long) v : d; }
        public int getInt(String k, int d) { Object v = m.get(k); return v instanceof Integer ? (Integer) v : d; }
        public boolean getBoolean(String k, boolean d) { Object v = m.get(k); return v instanceof Boolean ? (Boolean) v : d; }
        public Editor edit() {
            return new Editor() {
                public Editor putString(String k, String v) { m.put(k, v); return this; }
                public Editor putLong(String k, long v) { m.put(k, v); return this; }
                public Editor putInt(String k, int v) { m.put(k, v); return this; }
                public Editor putBoolean(String k, boolean v) { m.put(k, v); return this; }
                public Editor remove(String k) { m.remove(k); return this; }
                public void apply() { }
                public boolean commit() { return true; }
            };
        }
    }

    static final class FakeTicker implements AmsImpressionTracker.Ticker {
        long el = 1_000_000L, wall = 1_790_000_000_000L;
        public long elapsedMs() { return el; }
        public long wallMs() { return wall; }
        void advance(long ms) { el += ms; wall += ms; }
    }

    static byte[] seed() {
        byte[] s = new byte[32];
        for (int i = 0; i < 32; i++) s[i] = (byte) (i + 1);
        return s;
    }

    static String sha256(byte[] b) throws Exception { return AmsClient.hex(MessageDigest.getInstance("SHA-256").digest(b)); }

    public static void main(String[] args) throws Exception {
        File tmp = Files.createTempDirectory("ams-check").toFile();
        signingVectors(new StubContext(tmp));
        overlaySpec();
        tracker(tmp);
        scheduler(tmp);
        if (args.length > 0) liveGateway(args[0], tmp);
        System.out.println(failures == 0 ? "ALL OK (" + passed + " checks)" : "FAILURES: " + failures + " of " + (passed + failures));
        System.exit(failures == 0 ? 0 : 1);
    }

    // ---- 1. docs/DEVICE-PROTOCOL.md section 3.4 vectors ----
    static void signingVectors(StubContext ctx) throws Exception {
        System.out.println("signing vectors (DEVICE-PROTOCOL 3.4)");
        AmsKeys keys = AmsKeys.fromSeed(seed());
        ok("ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ".equals(keys.publicKeyB64u()), "public key from seed 01..20");
        AmsClient c = new AmsClient(ctx, keys, "https://example.invalid", "1.0.39", false);
        byte[] bodyA = "{\"state\":1,\"app_ver\":\"2.4.1\"}".getBytes(StandardCharsets.UTF_8);
        ok("9c988fe6254f7a3302fb33f879385e791d10bda67dc85368fe881620f4382373".equals(sha256(bodyA)), "sha256 of vector A body");
        ok("CXnm2wux9_DA7w9k-ffoDVttGjqKMHjnqqfFVyE27vpclPh3_0WZ3ygHkxv8XPjybGuxllXWqns0Faj8MlvoCQ"
            .equals(c.sign("POST", "/v1/heartbeat", 1790000000L, "dGVzdC1ub25jZS0wMDAxMjM0NQ", bodyA)), "signature vector A (POST heartbeat)");
        ok("mXpRgShahnYz44uqDrSX6u8DA7shknkoBs5gFUwr4locDX74EgL8DU3XwagpYkjBeych2IcTcg-K9lMe_W4gCg"
            .equals(c.sign("GET", "/v1/manifest?etag=0123456789abcdef", 1790000000L, "dGVzdC1ub25jZS0wMDAyMzQ1Ng", new byte[0])), "signature vector B (GET manifest, empty body)");
        ok(AmsClient.SHA256_EMPTY.equals(sha256(new byte[0])), "empty-body sha256 constant");
        String id = AmsImpressionTracker.uuidV7(1_790_000_000_000L);
        ok(id.matches("^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"), "uuidV7 shape " + id);
        ok(AmsClient.isoUtc(1_790_000_000_000L).endsWith("Z") && AmsClient.parseIsoMs(AmsClient.isoUtc(1_790_000_000_000L)) == 1_790_000_000_000L, "ISO round trip");
    }

    // ---- 2. overlay schema (same rules as schema/overlay.ts) ----
    static JSONObject vf9() throws Exception {
        String s = new String(Files.readAllBytes(new File("../../schema/overlay.example.vf9.json").toPath()), StandardCharsets.UTF_8);
        return new JSONObject(s);
    }

    static void overlaySpec() throws Exception {
        System.out.println("overlay spec");
        JSONObject o = vf9();
        AmsOverlaySpec s = AmsOverlaySpec.parse(o, new JSONObject());
        ok("VinFast VF 9 - Đỉnh Cao Trải Nghiệm Doanh Nhân".equals(s.headline) && "1900 23 23 89".equals(s.hotlineNumber), "VF9 example parses with the exact ADS.png texts");
        ok(s.kidSafe && s.allows("lock") && s.durationS == 15 && s.badges.size() == 1, "kid_safe/contexts/duration/badges");
        String[][] bad = {
            {"v", "2"}, {"badges", "[\"a\",\"b\",\"c\",\"d\",\"e\",\"f\",\"g\"]"}, {"qr", "{\"url\":\"http://x.vn/a\",\"title\":\"T\"}"},
            {"duration_s", "3"}, {"safe_area", "{\"top\":30}"}, {"contexts", "[\"tv\"]"}, {"scte_id", "\"bad id!\""},
            {"background", "{\"url\":\"https://m.anio.vn/a.jpg\",\"sha256\":\"zz\",\"px_w\":1920,\"px_h\":1080}"},
            {"background", "{\"url\":\"https://m.anio.vn/a.jpg\",\"sha256\":\"" + "a".repeat(64) + "\",\"px_w\":1920,\"px_h\":1000}"},
        };
        for (String[] b : bad) {
            JSONObject copy = new JSONObject(vf9().toString());
            copy.put(b[0], b[1].startsWith("{") || b[1].startsWith("[") ? parseAny(b[1]) : (Object) numOrString(b[1]));
            boolean rejected;
            try { AmsOverlaySpec.parse(copy, new JSONObject()); rejected = false; } catch (IllegalArgumentException e) { rejected = true; }
            ok(rejected, "rejects invalid " + b[0] + "=" + b[1]);
        }
        JSONObject noBg = vf9();
        noBg.put("background", JSONObject.NULL);
        JSONObject creative = new JSONObject().put("url", "https://media.anio.vn/x.jpg").put("sha256", "b".repeat(64)).put("px_w", 3840).put("px_h", 2160);
        ok("b".repeat(64).equals(AmsOverlaySpec.parse(noBg, creative).bgSha256), "background falls back to the creative file (single source of truth)");
    }

    static Object parseAny(String json) throws Exception {
        return json.startsWith("[") ? new JSONObject("{\"a\":" + json + "}").optJSONArray("a") : new JSONObject(json);
    }

    static Object numOrString(String v) {
        if (v.startsWith("\"")) return v.substring(1, v.length() - 1);
        try { return Integer.valueOf(v); } catch (Exception e) { return v; }
    }

    // ---- 3. impression counting ----
    static void tracker(File tmp) throws Exception {
        System.out.println("impression tracker");
        File dir = new File(tmp, "tracker");
        FakeTicker t = new FakeTicker();
        AmsImpressionTracker tr = new AmsImpressionTracker(dir, t);

        tr.begin("C1", "CR1", "S1", "lock", 15_000);
        t.advance(15_000);
        AmsImpressionTracker.Outcome full = tr.end("complete");
        ok(full.queued && full.vcrPct == 100 && full.visibleMs == 15_000, "uninterrupted 15 s play is queued with vcr 100");

        tr.begin("C1", "CR1", "S1", "lock", 10_000);
        t.advance(6_000); tr.block("screen_off"); t.advance(5_000); tr.unblock("screen_off"); t.advance(4_000);
        AmsImpressionTracker.Outcome gated = tr.end("complete");
        ok(gated.queued && gated.visibleMs == 10_000, "screen-off time (5 s) is not counted: visible 10 s, wall 15 s");

        tr.begin("C1", "CR1", "S1", "lock", 10_000);
        t.advance(7_000); tr.block("covered"); t.advance(60_000);
        AmsImpressionTracker.Outcome partial = tr.end("lock_removed");
        ok(!partial.queued && partial.vcrPct == 70 && tr.droppedPartial() == 1, "70% play while covered is dropped (not sent as valid)");
        tr.unblock("covered");     // blockers describe the screen, not the play: the coordinator clears them when the cover goes away

        List<String> batch = tr.peekBatch();
        ok(batch.size() == 2, "two valid impressions queued");
        JSONObject e0 = new JSONObject(batch.get(0));
        ok("impression".equals(e0.optString("type")) && e0.optInt("vcr_pct", 0) == 100 && e0.optInt("played_ms", 0) == 15_000
            && e0.optString("event_id").length() == 36 && e0.optString("ts").endsWith("Z"), "event fields: " + batch.get(0));
        ok(AmsImpressionTracker.batchBody(batch).startsWith("{\"events\":["), "batch body shape");
        tr.ack(batch);
        ok(tr.pending() == 0, "ack removes sent events");

        for (int i = 0; i < 120; i++) { tr.begin("C", "CR", "", "lock", 5000); t.advance(5000); tr.end("complete"); }
        ok(tr.peekBatch().size() == 50, "batch is capped at 50 events");

        AmsImpressionTracker tr2 = new AmsImpressionTracker(dir, t);       // restart: queue survives on disk
        ok(tr2.pending() == 120, "queue survives restart (120 events on disk)");
        t.advance(48L * 3600_000L);
        ok(tr2.pending() == 0 && tr2.droppedExpired() == 120, "events older than 47 h are dropped locally");
    }

    // ---- 4. scheduler ----
    static JSONObject creative(String id, String campaign, String sha, int pxW, JSONObject overlay) throws Exception {
        return new JSONObject().put("id", id).put("campaign_id", campaign).put("url", "https://media.anio.vn/" + id + ".jpg")
            .put("sha256", sha).put("duration_s", JSONObject.NULL).put("px_w", pxW).put("px_h", pxW * 9 / 16).put("format", "fullscreen")
            .put("media_type", "image").put("size_bytes", 2).put("overlay", overlay);
    }

    static void scheduler(File tmp) throws Exception {
        System.out.println("scheduler");
        File base = new File(tmp, "sched");
        StubContext ctx = new StubContext(base);
        AmsAdScheduler.Config cfg = new AmsAdScheduler.Config();
        cfg.minGapMs = 60_000L;
        AmsAdScheduler sch = new AmsAdScheduler(ctx, base, cfg);
        byte[] bytesA = "bgA".getBytes(StandardCharsets.UTF_8), bytesB = "bgB".getBytes(StandardCharsets.UTF_8);
        String shaA = sha256(bytesA), shaB = sha256(bytesB);
        Files.write(sch.fileFor(shaA).toPath(), bytesA);
        Files.write(sch.fileFor(shaB).toPath(), bytesB);

        JSONObject ovA = vf9(); ovA.put("background", new JSONObject().put("url", "https://media.anio.vn/a.jpg").put("sha256", shaA).put("px_w", 1920).put("px_h", 1080));
        JSONObject ovB = vf9(); ovB.put("background", new JSONObject().put("url", "https://media.anio.vn/b.jpg").put("sha256", shaB).put("px_w", 1920).put("px_h", 1080));
        JSONObject ovNotKid = vf9(); ovNotKid.put("kid_safe", false);
        ovNotKid.put("background", new JSONObject().put("url", "https://media.anio.vn/a.jpg").put("sha256", shaA).put("px_w", 1920).put("px_h", 1080));

        JSONArray creatives = new JSONArray().put(creative("CA", "K1", shaA, 1920, ovA)).put(creative("CB", "K2", shaB, 1920, ovB)).put(creative("CN", "K3", shaA, 1920, ovNotKid));
        JSONArray schedule = new JSONArray()
            .put(new JSONObject().put("slot_id", "SA").put("campaign_id", "K1").put("creative_ids", new JSONArray().put("CA")).put("start_min", 0).put("end_min", 1440).put("priority", 2).put("reward_points", 0))
            .put(new JSONObject().put("slot_id", "SB").put("campaign_id", "K2").put("creative_ids", new JSONArray().put("CB")).put("start_min", 0).put("end_min", 1440).put("priority", 2).put("reward_points", 0))
            .put(new JSONObject().put("slot_id", "SN").put("campaign_id", "K3").put("creative_ids", new JSONArray().put("CN")).put("start_min", 0).put("end_min", 1440).put("priority", 1).put("reward_points", 0))
            .put(new JSONObject().put("slot_id", "SX").put("campaign_id", "K1").put("creative_ids", new JSONArray().put("CA")).put("start_min", 0).put("end_min", 1).put("priority", 0).put("reward_points", 0));
        JSONObject m = new JSONObject().put("version", 1).put("group", "HN.all.tv").put("tz", "Asia/Ho_Chi_Minh").put("etag", "e1").put("ttl_s", 900)
            .put("creatives", creatives).put("schedule", schedule);
        long now = 1_790_000_000_000L + 3 * 3600_000L;       // arbitrary instant; localMinutes() is computed from it
        sch.adopt(m, now);

        AmsAdScheduler.Pick p1 = sch.peek("lock", now);
        ok(p1 != null && !"CN".equals(p1.creativeId), "lock never picks a creative that is not kid_safe (priority 1 slot skipped)");
        ok(p1 != null && p1.durationMs == 15_000L, "duration falls back to overlay.duration_s when manifest duration_s is null");
        sch.commit(p1, now);
        ok(sch.peek("lock", now + 30_000L) == null, "global gap: nothing within 60 s");
        AmsAdScheduler.Pick p2 = sch.peek("lock", now + 61_000L);
        ok(p2 != null && !p2.creativeId.equals(p1.creativeId), "same priority rotates to the other creative");
        ok(sch.peek("pause", now + 61_000L) == null, "fullscreen creatives are not offered for the pause context");
        ok(AmsAdScheduler.localMinutes("Asia/Ho_Chi_Minh", 1_790_000_000_000L) == AmsAdScheduler.localMinutes("Asia/Ho_Chi_Minh", 1_790_000_000_000L + 86_400_000L), "localMinutes is periodic by day");

        JSONObject delta = new JSONObject().put("version", 1).put("group", "HN.all.tv").put("etag", "e2").put("base_etag", "e1").put("ttl_s", 900)
            .put("creatives_added", new JSONArray().put(creative("CC", "K4", shaA, 1920, ovA)))
            .put("creatives_removed", new JSONArray().put("CB").put("CN"))
            .put("schedule", new JSONArray().put(new JSONObject().put("slot_id", "SC").put("campaign_id", "K4").put("creative_ids", new JSONArray().put("CC")).put("start_min", 0).put("end_min", 1440).put("priority", 1).put("reward_points", 0)));
        JSONObject merged = AmsAdScheduler.mergeDelta(m, delta);
        ok(merged.optJSONArray("creatives").length() == 2 && "e2".equals(merged.optString("etag")) && AmsAdScheduler.consistent(merged), "delta merge: (old - removed) + added, schedule replaced, consistent");
        delta.put("schedule", new JSONArray().put(new JSONObject().put("slot_id", "SZ").put("creative_ids", new JSONArray().put("MISSING")).put("start_min", 0).put("end_min", 1440)));
        ok(!AmsAdScheduler.consistent(AmsAdScheduler.mergeDelta(m, delta)), "consistency check catches a schedule referencing an unknown creative");

        sch.adopt(merged, now);
        sch.purge(null);
        ok(sch.cacheFiles() == 2, "purge keeps files of the previous manifest (events for it are still accepted)");
        sch.adopt(new JSONObject(merged.toString()), now);
        sch.purge(null);
        ok(sch.cacheFiles() == 1 && sch.fileFor(shaA).isFile() && !sch.fileFor(shaB).isFile(), "purge then removes the file no current/previous manifest references");
    }

    // ---- 5. live gateway ----
    static String postRaw(String url, String json) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod("POST"); c.setDoOutput(true); c.setRequestProperty("Content-Type", "application/json");
        try (OutputStream o = c.getOutputStream()) { o.write(json.getBytes(StandardCharsets.UTF_8)); }
        int code = c.getResponseCode();
        return code + " " + new String((code >= 400 ? c.getErrorStream() : c.getInputStream()).readAllBytes(), StandardCharsets.UTF_8);
    }

    static void liveGateway(String base, File tmp) throws Exception {
        System.out.println("live gateway " + base);
        File d = new File(tmp, "live"); d.mkdirs();
        StubContext ctx = new StubContext(d);
        byte[] seed = new byte[32]; new java.security.SecureRandom().nextBytes(seed);
        AmsKeys keys = AmsKeys.fromSeed(seed);
        AmsClient c = new AmsClient(ctx, keys, base, "1.0.39", true);

        ok(c.ensureRegistered("StubTV", "android30", "HN") && !c.deviceId().isEmpty(), "register -> device_id " + c.deviceId());
        AmsClient.Resp p1 = c.pair();
        String code = p1.json().optString("code", "");
        ok(p1.ok() && !p1.json().optBoolean("paired", true) && code.matches("\\d{6}"), "pair -> code " + code);
        String confirm = postRaw(base + "/v1/dev/pair-confirm", "{\"code\":\"" + code + "\"}");
        ok(confirm.startsWith("200"), "dev pair-confirm (stand-in for the AMS phone app): " + confirm);
        AmsClient.Resp p2 = c.pair();
        ok(p2.ok() && p2.json().optBoolean("paired", false) && c.trustLevel() == 1, "pair poll -> paired, trust_level 1");

        AmsClient.Resp hb = c.heartbeat(new JSONObject().put("state", 1).put("app_ver", "1.0.39").put("cache_used_mb", 12));
        long next = hb.json().optLong("next_interval", 0);
        String etag = hb.json().optString("manifest_etag", "");
        ok(hb.ok() && next >= 240 && next <= 360 && !etag.isEmpty(), "heartbeat -> next_interval " + next + " s (base 300 +-20%), etag " + etag);

        AmsClient.Resp mf = c.manifest(null, false);
        JSONObject manifest = mf.json();
        ok(mf.ok() && manifest.optJSONArray("creatives") != null && manifest.optJSONArray("creatives").length() > 0 && mf.etag.equals(manifest.optString("etag")), "manifest full: " + manifest.optJSONArray("creatives").length() + " creatives, etag " + mf.etag);
        ok(c.manifest(mf.etag, true).status == 304, "manifest with held etag -> 304");

        // clock skew: a TV whose clock is 1000 s slow must learn the offset from 401 stale_timestamp and succeed
        StubContext skewCtx = new StubContext(d);
        skewCtx.store.putAll(ctx.store);
        skewCtx.store.put(AmsClient.K_CLOCK_OFFSET, -1000L);
        AmsClient skewed = new AmsClient(skewCtx, keys, base, "1.0.39", true);
        AmsClient.Resp hb2 = skewed.heartbeat(new JSONObject().put("state", 1));
        ok(hb2.ok() && Math.abs(skewed.clockOffsetS()) < 5, "stale_timestamp -> offset corrected (now " + skewed.clockOffsetS() + " s) and retried");

        // a real impression for the first manifest creative/slot, full duration
        JSONObject cr = manifest.optJSONArray("creatives").optJSONObject(0);
        JSONObject slot = null;
        JSONArray sc = manifest.optJSONArray("schedule");
        for (int i = 0; i < sc.length() && slot == null; i++) {
            JSONArray ids = sc.optJSONObject(i).optJSONArray("creative_ids");
            for (int j = 0; j < ids.length(); j++) if (ids.optString(j).equals(cr.optString("id"))) slot = sc.optJSONObject(i);
        }
        long durMs = (cr.isNull("duration_s") ? 15 : cr.optLong("duration_s", 15)) * 1000L;
        FakeTicker t = new FakeTicker();
        t.wall = c.nowMs(); t.el = 5_000_000L;
        AmsImpressionTracker tr = new AmsImpressionTracker(new File(d, "q"), t);
        tr.begin(cr.optString("campaign_id"), cr.optString("id"), slot == null ? "" : slot.optString("slot_id"), "lock", durMs);
        t.advance(durMs);
        ok(tr.end("complete").queued, "impression queued for creative " + cr.optString("id"));
        List<String> batch = tr.peekBatch();
        AmsClient.Resp ev = c.events(AmsImpressionTracker.batchBody(batch));
        ok(ev.status == 202 && ev.json().optInt("accepted", 0) == 1 && ev.json().optInt("valid", 0) == 1 && ev.json().optInt("flagged", 9) == 0, "events -> " + ev.status + " " + ev.body);
        AmsClient.Resp again = c.events(AmsImpressionTracker.batchBody(batch));
        ok(again.status == 202, "re-sending the same batch is accepted (idempotent by event_id): " + again.body);

        // partial play sent anyway would be flagged: prove the server rule the client relies on
        FakeTicker t2 = new FakeTicker(); t2.wall = c.nowMs(); t2.el = 9_000_000L;
        JSONObject bad = new JSONObject(batch.get(0));
        bad.put("event_id", AmsImpressionTracker.uuidV7(t2.wall)).put("vcr_pct", 60).put("played_ms", (int) (durMs * 0.6));
        AmsClient.Resp flagged = c.events(new JSONObject().put("events", new JSONArray().put(bad)).toString());
        ok(flagged.status == 202 && flagged.json().optInt("flagged", 0) == 1, "a 60% play would be flagged (valid=0), hence the client never sends partials: " + flagged.body);
    }
}
