package vn.brainrot.parental.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.View;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Glue between TvBridgeService (foreground service that keeps the process alive), the AMS gateway
 * (AmsClient), the scheduler/cache, the renderer and the impression tracker.
 *
 * Threads: one worker ("ams-coordinator") does all network, disk and bitmap decoding; the main thread only builds
 * views, touches WindowManager through TvOverlayController and measures visibility (1 s tick).
 *
 * Nothing runs until a parent has opted in from the phone app (command "ads-config", prefs ads_enabled) and the
 * overlay permission exists; ads additionally require the TV to be linked to an AMS account (trust_level >= 1),
 * otherwise the gateway would flag every impression as untrusted and nobody would pay for them.
 */
final class AmsCoordinator {
    private static final String TAG = "AmsCoordinator";
    static final String K_ENABLED = "ads_enabled";
    static final String K_REGION = "region";
    static final String K_GATEWAY = "gateway";
    static final String K_ETAG = "manifest_etag";
    static final String K_MANIFEST_SAVED_AT = "manifest_saved_at";
    private static final long FLUSH_MIN_MS = 5 * 60_000L;
    private static final long FLUSH_SPAN_MS = 5 * 60_000L;       // 5..10 minutes (section 8.3)
    private static final int FLUSH_AT_COUNT = 20;
    private static final long PAIR_POLL_MS = 8_000L;
    private static final long AD_SESSION_MAX_MS = 10 * 60_000L;  // a play that stays blocked this long is abandoned (partial)

    private static AmsCoordinator instance;

    /** What the receiver screen / phone shows while linking the TV to an AMS account. */
    static final class PairSnapshot {
        final boolean registered, paired; final String code; final String error;
        /** SystemClock.elapsedRealtime() base (immune to the TV's wrong wall clock); 0 when there is no code. */
        final long expiresAtElapsedMs;
        PairSnapshot(boolean registered, boolean paired, String code, long expiresAtElapsedMs, String error) {
            this.registered = registered; this.paired = paired; this.code = code; this.expiresAtElapsedMs = expiresAtElapsedMs; this.error = error;
        }
    }

    private static final class Prepared {
        final AmsAdScheduler.Pick pick; final Bitmap bitmap; final String etag;
        Prepared(AmsAdScheduler.Pick pick, Bitmap bitmap, String etag) { this.pick = pick; this.bitmap = bitmap; this.etag = etag; }
    }

    private static final class Active {
        final Prepared prepared; final long startedElapsedMs;
        Active(Prepared prepared, long startedElapsedMs) { this.prepared = prepared; this.startedElapsedMs = startedElapsedMs; }
    }

    private final Context app;
    private final SharedPreferences prefs;
    private final File dir;
    private final AmsClient client;
    private final AmsKeys keys;
    private final AmsAdScheduler scheduler;
    private final AmsImpressionTracker tracker;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Object wakeLock = new Object();
    private boolean wakeFlag;
    private volatile boolean stopped;
    private Thread worker;

    // worker-thread state
    private JSONObject staged;
    private long stagedDeadlineMs;
    private long lastManifestCheckMs;
    private long nextHeartbeatAtMs;
    private long nextFlushAtMs;
    private int flushFailures;
    private long nextPairPollAtMs;
    private final List<String> pendingAcks = new ArrayList<>();
    private boolean monitorMode;
    private boolean lastCycleFailed;

    // shared state
    private volatile boolean pairingVisible;
    private volatile PairSnapshot pairSnapshot = new PairSnapshot(false, false, "", 0L, "");
    private volatile Prepared prepared;
    private volatile boolean lockAttached;
    private volatile int adZoneW = 1325, screenH = 1080;
    private Active active;                       // main thread only

    private AmsCoordinator(Context context) {
        this.app = context.getApplicationContext();
        this.prefs = app.getSharedPreferences(AmsClient.PREFS, Context.MODE_PRIVATE);
        this.dir = new File(app.getFilesDir(), "ams");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        this.keys = AmsKeys.load(app);
        String version = "";
        try { version = app.getPackageManager().getPackageInfo(app.getPackageName(), 0).versionName; } catch (Exception ignored) { }
        this.client = new AmsClient(app, keys, prefs.getString(K_GATEWAY, AmsClient.DEFAULT_GATEWAY), version, false);
        AmsAdScheduler.Config cfg = new AmsAdScheduler.Config();
        DisplayMetrics dm = app.getResources().getDisplayMetrics();
        cfg.screenWidthPx = Math.max(dm.widthPixels, dm.heightPixels);
        this.screenH = Math.min(dm.widthPixels, dm.heightPixels);
        this.adZoneW = (int) (cfg.screenWidthPx * AmsOverlayRenderer.LOCK_AD_FRACTION);
        this.scheduler = new AmsAdScheduler(app, dir, cfg);
        this.tracker = new AmsImpressionTracker(dir, new AmsImpressionTracker.Ticker() {
            @Override public long elapsedMs() { return SystemClock.elapsedRealtime(); }
            @Override public long wallMs() { return client.nowMs(); }
        });
        loadSavedManifest();
    }

    // ---------- lifecycle (called from TvBridgeService) ----------

    static synchronized void start(Context context) {
        if (instance != null) return;
        AmsCoordinator c = new AmsCoordinator(context);
        instance = c;
        c.worker = new Thread(c::run, "ams-coordinator");
        c.worker.setDaemon(true);
        c.worker.start();
    }

    static synchronized void stop() {
        if (instance == null) return;
        instance.stopped = true;
        instance.main.removeCallbacksAndMessages(null);
        if (instance.worker != null) instance.worker.interrupt();
        instance = null;
    }

    private static synchronized AmsCoordinator get() { return instance; }

    // ---------- API used by TvOverlayController (main thread) ----------

    /** Called after WindowManager accepted the lock view. adZoneWidthPx = width of the free ad column. */
    static void onLockAttached(int adZoneWidthPx, int heightPx) {
        AmsCoordinator c = get();
        if (c == null) return;
        c.adZoneW = adZoneWidthPx;
        c.screenH = heightPx;
        c.lockAttached = true;
        c.main.removeCallbacks(c.tick);
        c.main.post(c.tick);
        c.wake();
    }

    /** Called whenever the lock view leaves the screen (unlock, replaced by another overlay, policy notice). */
    static void onLockDetached() {
        AmsCoordinator c = get();
        if (c == null) return;
        c.lockAttached = false;
        c.main.removeCallbacks(c.tick);
        if (c.active != null) c.endActive("lock_removed");
    }

    // ---------- API used by TvBridgeService / TvReceiverActivity ----------

    /** Local command "ads-config" {enabled?, region?}: only the authenticated parent phone can reach it (Bearer token). */
    static JSONObject configure(Context context, JSONObject payload) throws Exception {
        SharedPreferences p = context.getApplicationContext().getSharedPreferences(AmsClient.PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor e = p.edit();
        JSONObject effects = new JSONObject();
        if (payload.has("enabled")) {
            boolean enabled = payload.optBoolean("enabled", false);
            e.putBoolean(K_ENABLED, enabled);
            effects.put("adsEnabled", enabled);
        }
        String region = payload.optString("region", "");
        if (region.matches("[A-Z]{2,4}")) { e.putString(K_REGION, region); effects.put("region", region); }
        boolean saved = e.commit();
        effects.put("saved", saved);
        AmsCoordinator c = get();
        if (c != null) {
            c.wake();
            if (saved && !p.getBoolean(K_ENABLED, false)) c.main.post(() -> { if (c.active != null) c.endActive("disabled"); });
        }
        return effects;
    }

    static void setPairingVisible(boolean visible) {
        AmsCoordinator c = get();
        if (c == null) return;
        c.pairingVisible = visible;
        if (visible) c.wake();
    }

    static PairSnapshot pairingSnapshot() {
        AmsCoordinator c = get();
        return c == null ? new PairSnapshot(false, false, "", 0L, "not-running") : c.pairSnapshot;
    }

    /** Diagnostics block for GET /v1/state of the local bridge ("Ad Diagnostics"). */
    static JSONObject describe(Context context) {
        JSONObject o = new JSONObject();
        try {
            SharedPreferences p = context.getApplicationContext().getSharedPreferences(AmsClient.PREFS, Context.MODE_PRIVATE);
            o.put("adsEnabled", p.getBoolean(K_ENABLED, false));
            o.put("registered", !p.getString(AmsClient.K_DEVICE_ID, "").isEmpty());
            o.put("trustLevel", p.getInt(AmsClient.K_TRUST, 0));
            o.put("manifestEtag", p.getString(K_ETAG, ""));
            AmsCoordinator c = get();
            if (c != null) {
                o.put("keyProtection", c.keys.protection());
                o.put("queuedEvents", c.tracker.pending());
                o.put("partialPlaysDropped", c.tracker.droppedPartial());
                o.put("cacheFiles", c.scheduler.cacheFiles());
                o.put("cacheBytes", c.scheduler.cacheBytes());
                PairSnapshot ps = c.pairSnapshot;
                o.put("pairing", new JSONObject().put("paired", ps.paired).put("code", ps.code).put("expiresInS", Math.max(0L, (ps.expiresAtElapsedMs - SystemClock.elapsedRealtime()) / 1000L)));
            }
        } catch (Exception ignored) { /* diagnostics only */ }
        return o;
    }

    // ---------- worker loop ----------

    private void run() {
        waitFor(client.startupJitterMs());                      // 0..60 s after boot/start (DEVICE-PROTOCOL section 2)
        nextFlushAtMs = SystemClock.elapsedRealtime() + FLUSH_MIN_MS;
        while (!stopped) {
            long now = SystemClock.elapsedRealtime();
            long sleep = 30_000L;
            try {
                if (prefs.getBoolean(K_ENABLED, false)) {
                    sleep = cycle(now);
                } else {
                    sleep = 30_000L;                            // not opted in: no network traffic to AMS at all
                }
            } catch (Throwable t) {
                Log.w(TAG, "cycle failed", t);
                lastCycleFailed = true;
                sleep = 60_000L;
            }
            waitFor(Math.max(1000L, sleep));
        }
    }

    /** One pass; returns how long the worker may sleep. */
    private long cycle(long now) {
        if (!client.ensureRegistered(Build.MODEL, "android" + Build.VERSION.SDK_INT, prefs.getString(K_REGION, ""))) {
            return 30_000L + (long) (Math.random() * 30_000L);
        }
        long wait = 60_000L;
        if (pairingVisible && client.trustLevel() < 1 && now >= nextPairPollAtMs) {
            pollPair();
            nextPairPollAtMs = now + PAIR_POLL_MS;
        }
        if (pairingVisible && client.trustLevel() < 1) wait = Math.min(wait, PAIR_POLL_MS);

        if (now >= nextHeartbeatAtMs) {
            nextHeartbeatAtMs = now + heartbeat();
        } else if (staged != null) {
            continueStaged();                                   // finish a download that was interrupted
        }
        wait = Math.min(wait, Math.max(1000L, nextHeartbeatAtMs - now));

        if (tracker.pending() >= FLUSH_AT_COUNT || now >= nextFlushAtMs) {
            long retry = flushEvents();
            nextFlushAtMs = now + (retry > 0 ? retry : FLUSH_MIN_MS + (long) (Math.random() * FLUSH_SPAN_MS));
        }
        wait = Math.min(wait, Math.max(1000L, nextFlushAtMs - now));

        if (lockAttached) { prepareLockAd(); wait = Math.min(wait, 5_000L); }
        return wait;
    }

    /** @return milliseconds until the next heartbeat. */
    private long heartbeat() {
        AmsClient.Resp r = client.heartbeat(heartbeatBody());
        if (r.ok()) {
            lastCycleFailed = false;
            JSONObject j = r.json();
            pendingAcks.clear();
            JSONArray commands = j.optJSONArray("commands");
            boolean forceManifest = false;
            if (commands != null) for (int i = 0; i < commands.length(); i++) {
                JSONObject c = commands.optJSONObject(i);
                if (c == null) continue;
                String type = c.optString("type", "");
                if ("refresh_manifest".equals(type)) forceManifest = true;
                else if ("set_monitor".equals(type)) monitorMode = true;
                // "reboot" and unknown types: nothing safe to do in an app process, but they must still be acked
                if (pendingAcks.size() < 20 && !c.optString("id", "").isEmpty()) pendingAcks.add(c.optString("id"));
            }
            syncManifest(j.optString("manifest_etag", ""), forceManifest);
            return Math.max(5_000L, j.optLong("next_interval", 600L) * 1000L);   // exact value: the server already applied jitter
        }
        lastCycleFailed = true;
        if (r.status == 429 || r.status == 503) return Math.max(5_000L, r.retryAfterS * 1000L);
        if (r.status == 401 && "unknown_device".equals(r.errorCode)) { client.forgetDevice(); return 5_000L; }
        if (r.status == 403) return 3600_000L;                  // device_blocked: try again in an hour
        return 600_000L;                                        // network/5xx after 4 quick attempts: wait the default interval
    }

    private JSONObject heartbeatBody() {
        JSONObject b = new JSONObject();
        try {
            b.put("state", monitorMode ? 3 : lastCycleFailed ? 2 : (active != null ? 1 : 0));
            b.put("app_ver", app.getPackageManager().getPackageInfo(app.getPackageName(), 0).versionName);
        } catch (Exception ignored) { /* version is optional */ }
        try {
            int temp = socTempC();
            if (temp > -40 && temp < 150) b.put("soc_temp", temp);
            int rssi = wifiRssi();
            if (rssi < 0 && rssi > -120) b.put("rssi", rssi);
            b.put("cache_used_mb", (int) (scheduler.cacheBytes() / (1024 * 1024)));
            b.put("cache_slots", scheduler.cacheFiles());
            String etag = prefs.getString(K_ETAG, "");
            if (!etag.isEmpty()) b.put("manifest_etag", etag);
            if (!pendingAcks.isEmpty()) b.put("cmd_ack", new JSONArray(pendingAcks));
        } catch (Exception ignored) { /* telemetry is best effort */ }
        return b;
    }

    private int socTempC() {
        try (RandomAccessFile f = new RandomAccessFile("/sys/class/thermal/thermal_zone0/temp", "r")) {
            int v = Integer.parseInt(f.readLine().trim());
            return Math.abs(v) > 1000 ? v / 1000 : v;
        } catch (Throwable unavailable) { return -999; }       // not readable for apps on many Android versions
    }

    private int wifiRssi() {
        try {
            WifiManager wm = (WifiManager) app.getSystemService(Context.WIFI_SERVICE);
            return wm == null || wm.getConnectionInfo() == null ? 0 : wm.getConnectionInfo().getRssi();
        } catch (Throwable e) { return 0; }                    // Ethernet TVs: no Wi-Fi info
    }

    // ---------- pairing ----------

    private void pollPair() {
        AmsClient.Resp r = client.pair();
        if (r.ok()) {
            JSONObject j = r.json();
            if (j.optBoolean("paired", false)) {
                pairSnapshot = new PairSnapshot(true, true, "", 0L, "");
                nextHeartbeatAtMs = 0;                          // refresh state/manifest right away as a linked device
            } else {
                long expires = SystemClock.elapsedRealtime() + j.optLong("expires_in", 300L) * 1000L;
                pairSnapshot = new PairSnapshot(true, false, j.optString("code", ""), expires, "");
            }
        } else if (r.status == 429) {
            pairSnapshot = new PairSnapshot(true, false, "", 0L, "rate_limited");
            nextPairPollAtMs = SystemClock.elapsedRealtime() + Math.max(60_000L, r.retryAfterS * 1000L);
        } else {
            pairSnapshot = new PairSnapshot(true, false, "", 0L, "http_" + r.status);
        }
    }

    // ---------- manifest ----------

    private void syncManifest(String serverEtag, boolean force) {
        long now = client.nowMs();
        String held = prefs.getString(K_ETAG, "");
        if (staged != null && !staged.optString("etag").equals(serverEtag)) staged = null;   // superseded while downloading
        if (staged != null) { continueStaged(); return; }
        JSONObject cur = scheduler.manifest();
        long ttlMs = (cur == null ? 900 : cur.optInt("ttl_s", 900)) * 1000L;
        boolean ttlExpired = now - lastManifestCheckMs > ttlMs;
        if (!force && !ttlExpired && !serverEtag.isEmpty() && serverEtag.equals(held) && cur != null) return;
        boolean haveLocal = cur != null && !held.isEmpty();
        AmsClient.Resp r = client.manifest(haveLocal ? held : null, haveLocal);
        lastManifestCheckMs = now;
        if (r.status == 304) { scheduler.touch(now); return; }
        if (r.status != 200) return;
        try {
            JSONObject m = r.json();
            if ("delta".equals(r.manifestKind) && haveLocal) {
                JSONObject merged = AmsAdScheduler.mergeDelta(cur, m);
                if (AmsAdScheduler.consistent(merged)) {
                    m = merged;
                } else {                                          // doubtful delta: drop it and ask for the full manifest
                    AmsClient.Resp full = client.manifest(null, false);
                    if (full.status != 200) return;
                    m = full.json();
                }
            }
            staged = m;
            stagedDeadlineMs = System.currentTimeMillis() + 5 * 60_000L;
            continueStaged();
        } catch (Exception bad) {
            Log.w(TAG, "manifest rejected", bad);
        }
    }

    /** Switch to the staged manifest only after every renderable creative is on disk and verified (section 7.4). */
    private void continueStaged() {
        JSONObject m = staged;
        if (m == null) return;
        boolean ready = scheduler.prefetch(m, System.currentTimeMillis() + 120_000L);
        if (!ready && System.currentTimeMillis() < stagedDeadlineMs) return;   // retry on the next pass
        // If the deadline passed we still adopt: renderable() skips creatives whose file is missing, so nothing broken is shown.
        scheduler.adopt(m, client.nowMs());
        saveManifest(m);
        prefs.edit().putString(K_ETAG, m.optString("etag", "")).putLong(K_MANIFEST_SAVED_AT, client.nowMs()).apply();
        staged = null;
        scheduler.purge(null);
    }

    private void loadSavedManifest() {
        try {
            File f = new File(dir, "manifest.json");
            if (!f.isFile()) return;
            byte[] data = new byte[(int) f.length()];
            try (java.io.FileInputStream in = new java.io.FileInputStream(f)) { if (in.read(data) != data.length) return; }
            JSONObject m = new JSONObject(new String(data, StandardCharsets.UTF_8));
            scheduler.adopt(m, prefs.getLong(K_MANIFEST_SAVED_AT, 0L));
        } catch (Exception corrupt) { /* start without a manifest; the next heartbeat refetches */ }
    }

    private void saveManifest(JSONObject m) {
        File tmp = new File(dir, "manifest.json.tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(m.toString().getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (Exception e) { return; }
        //noinspection ResultOfMethodCallIgnored
        tmp.renameTo(new File(dir, "manifest.json"));
    }

    // ---------- events ----------

    /** @return 0 on success/nothing to do, else milliseconds to wait before trying again. */
    private long flushEvents() {
        for (int rounds = 0; rounds < 10; rounds++) {
            List<String> batch = tracker.peekBatch();
            if (batch.isEmpty()) { flushFailures = 0; return 0L; }
            AmsClient.Resp r = client.events(AmsImpressionTracker.batchBody(batch));
            if (r.status == 202) {
                tracker.ack(batch);                             // accepted or permanently rejected: either way never resend
                flushFailures = 0;
                continue;
            }
            if (r.status == 429 || r.status == 503) return Math.max(30_000L, r.retryAfterS * 1000L);
            if (r.status == 401 && "unknown_device".equals(r.errorCode)) { client.forgetDevice(); return 30_000L; }
            if (r.status == 400 || r.status == 413 || r.status == 422) {
                if (batch.size() == 1) tracker.ack(batch);      // a single event the server will never accept
                else splitAndSend(batch);
                continue;
            }
            flushFailures++;                                    // network/5xx/403/401: keep everything on disk
            return Math.min(15 * 60_000L, Math.max(30_000L, client.backoffMs(flushFailures + 4)));
        }
        return 0L;
    }

    /** A 4xx on a whole batch means at least one poison event: bisect so the good ones still get through. */
    private void splitAndSend(List<String> batch) {
        int half = batch.size() / 2;
        List<List<String>> parts = new ArrayList<>();
        parts.add(new ArrayList<>(batch.subList(0, half)));
        parts.add(new ArrayList<>(batch.subList(half, batch.size())));
        for (List<String> part : parts) {
            if (part.isEmpty()) continue;
            AmsClient.Resp r = client.events(AmsImpressionTracker.batchBody(part));
            if (r.status == 202) tracker.ack(part);
            else if ((r.status == 400 || r.status == 413 || r.status == 422) && part.size() == 1) tracker.ack(part);
        }
    }

    // ---------- lock ad (worker prepares, main thread shows) ----------

    private boolean adsAllowed() {
        return prefs.getBoolean(K_ENABLED, false) && client.trustLevel() >= 1;
    }

    private void prepareLockAd() {
        if (!lockAttached || prepared != null || !adsAllowed()) return;
        long now = client.nowMs();
        AmsAdScheduler.Pick pick = scheduler.peek(AmsOverlaySpec.CTX_LOCK, now);
        if (pick == null) return;
        Bitmap bmp = AmsOverlayRenderer.decodeBackground(pick.file, adZoneW, screenH);
        if (bmp == null) return;
        prepared = new Prepared(pick, bmp, prefs.getString(K_ETAG, ""));
    }

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!lockAttached) return;
            try { tickOnce(); } catch (Throwable t) { Log.w(TAG, "tick failed", t); }
            main.postDelayed(this, 1000L);
        }
    };

    private void tickOnce() {
        PowerManager pm = (PowerManager) app.getSystemService(Context.POWER_SERVICE);
        boolean screenOn = pm == null || pm.isInteractive();
        tracker.setBlocked("screen_off", !screenOn);            // a TV in standby/panel-off must not accrue view time
        boolean allowed = adsAllowed();
        if (active != null) {
            long age = SystemClock.elapsedRealtime() - active.startedElapsedMs;
            if (!allowed) endActive("disabled");
            else if (tracker.remainingMs() <= 0L) endActive("complete");
            else if (age > AD_SESSION_MAX_MS) endActive("timeout");
            return;
        }
        Prepared p = prepared;
        if (p == null || !allowed || !screenOn) return;
        if (!p.etag.equals(prefs.getString(K_ETAG, ""))) { prepared = null; recycle(p); wake(); return; }   // manifest changed meanwhile
        long now = client.nowMs();
        if (!scheduler.mayShow(now)) return;
        View view = AmsOverlayRenderer.build(app, p.pick.spec, p.bitmap, AmsOverlayRenderer.Layout.LOCK_SPLIT, adZoneW, screenH);
        if (!TvOverlayController.setLockAdView(view)) return;
        scheduler.commit(p.pick, now);
        tracker.begin(p.pick.campaignId, p.pick.creativeId, p.pick.slotId, p.pick.context, p.pick.durationMs);
        tracker.unblock("screen_off");
        prepared = null;
        active = new Active(p, SystemClock.elapsedRealtime());
    }

    private void endActive(String reason) {
        Active a = active;
        if (a == null) return;
        active = null;
        TvOverlayController.setLockAdView(null);
        AmsImpressionTracker.Outcome o = tracker.end(reason);
        Log.i(TAG, "ad " + a.prepared.pick.creativeId + " ended: " + reason + " visibleMs=" + o.visibleMs + " queued=" + o.queued);
        recycle(a.prepared);
        wake();
    }

    private static void recycle(Prepared p) {
        if (p != null && p.bitmap != null && !p.bitmap.isRecycled()) p.bitmap.recycle();
    }

    // ---------- worker wait/wake ----------

    private void wake() {
        synchronized (wakeLock) { wakeFlag = true; wakeLock.notifyAll(); }
    }

    private void waitFor(long ms) {
        long end = SystemClock.elapsedRealtime() + ms;
        synchronized (wakeLock) {
            while (!wakeFlag && !stopped) {
                long left = end - SystemClock.elapsedRealtime();
                if (left <= 0) break;
                try { wakeLock.wait(left); } catch (InterruptedException e) { Thread.currentThread().interrupt(); return; }
            }
            wakeFlag = false;
        }
    }
}
