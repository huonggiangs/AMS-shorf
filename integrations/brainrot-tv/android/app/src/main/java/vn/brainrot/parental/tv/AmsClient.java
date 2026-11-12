package vn.brainrot.parental.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Signed HTTP client for the AMS edge gateway, implementing docs/DEVICE-PROTOCOL.md (a3-gateway):
 * Ed25519 over "METHOD\nPATH_AND_QUERY\nTS\nNONCE\nSHA256HEX(BODY)", fresh nonce on every attempt,
 * clock-offset learning from 401 stale_timestamp, Retry-After honoured, exponential backoff with full jitter.
 * Blocking: call only from a worker thread (AmsCoordinator), never from the main thread.
 */
final class AmsClient {
    static final String PREFS = "brainrot_ams";
    static final String DEFAULT_GATEWAY = "https://gw-ams.anio.vn";
    static final String K_DEVICE_ID = "device_id";
    static final String K_CLOCK_OFFSET = "clock_offset_s";
    static final String K_TRUST = "trust_level";
    private static final int CONNECT_MS = 10_000;
    private static final int READ_MS = 20_000;
    private static final int MAX_QUICK_ATTEMPTS = 4;   // DEVICE-PROTOCOL section 10.2
    private static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
    static final String SHA256_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    /** One HTTP exchange. status 0 means a network failure (no HTTP response). */
    static final class Resp {
        final int status;
        final String body;
        final String etag;
        final String manifestKind;   // "full" | "delta" | ""
        final long retryAfterS;      // 0 when absent
        final String errorCode;      // "" when not an error body

        Resp(int status, String body, String etag, String manifestKind, long retryAfterS, String errorCode) {
            this.status = status; this.body = body == null ? "" : body; this.etag = etag == null ? "" : etag;
            this.manifestKind = manifestKind == null ? "" : manifestKind; this.retryAfterS = retryAfterS;
            this.errorCode = errorCode == null ? "" : errorCode;
        }

        boolean ok() { return status >= 200 && status < 300; }

        JSONObject json() {
            try { return body.isEmpty() ? new JSONObject() : new JSONObject(body); }
            catch (Exception e) { return new JSONObject(); }
        }
    }

    private final SharedPreferences prefs;
    private final AmsKeys keys;
    private final String baseUrl;
    private final boolean allowCleartext;
    private final SecureRandom random = new SecureRandom();
    private final String appVersion;
    private volatile long clockOffsetS;

    AmsClient(Context ctx, AmsKeys keys, String baseUrl, String appVersion, boolean allowCleartext) {
        this.prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.keys = keys;
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.appVersion = appVersion == null ? "" : appVersion;
        this.allowCleartext = allowCleartext;
        this.clockOffsetS = prefs.getLong(K_CLOCK_OFFSET, 0L);
    }

    // ---------- identity state ----------

    String deviceId() { return prefs.getString(K_DEVICE_ID, ""); }
    int trustLevel() { return prefs.getInt(K_TRUST, 0); }
    long clockOffsetS() { return clockOffsetS; }
    /** Gateway time in ms (device clock + learned offset). */
    long nowMs() { return System.currentTimeMillis() + clockOffsetS * 1000L; }
    void forgetDevice() { prefs.edit().remove(K_DEVICE_ID).putInt(K_TRUST, 0).apply(); }

    // ---------- endpoints ----------

    /** POST /v1/register. Idempotent per public key (200 returns the same device_id). Returns true when device_id is known. */
    boolean ensureRegistered(String model, String os, String region) {
        if (!deviceId().isEmpty()) return true;
        JSONObject body = new JSONObject();
        try {
            body.put("pubkey", keys.publicKeyB64u());
            body.put("kind", "tv");
            if (model != null && !model.isEmpty()) body.put("model", clip(model, 80));
            if (os != null && !os.isEmpty()) body.put("os", clip(os, 40));
            if (!appVersion.isEmpty()) body.put("app_version", clip(appVersion, 20));
            if (region != null && !region.isEmpty()) body.put("region", clip(region, 16));
        } catch (Exception e) { throw new IllegalStateException(e); }
        Resp r = call("POST", "/v1/register", body.toString().getBytes(StandardCharsets.UTF_8), true);
        if (r.status != 200 && r.status != 201) return false;
        JSONObject j = r.json();
        String id = j.optString("device_id", "");
        if (id.isEmpty()) return false;
        learnServerTime(j.optString("server_time", ""));
        prefs.edit().putString(K_DEVICE_ID, id).putInt(K_TRUST, j.optInt("trust_level", 0)).apply();
        return true;
    }

    /** POST /v1/pair with body {}: returns {paired,code,expires_in} or {paired:true,trust_level}. Poll every 5-10 s while the code is on screen. */
    Resp pair() {
        Resp r = call("POST", "/v1/pair", "{}".getBytes(StandardCharsets.UTF_8), false);
        if (r.ok() && r.json().optBoolean("paired", false)) {
            prefs.edit().putInt(K_TRUST, Math.max(1, r.json().optInt("trust_level", 1))).apply();
        }
        return r;
    }

    Resp heartbeat(JSONObject body) {
        Resp r = call("POST", "/v1/heartbeat", body.toString().getBytes(StandardCharsets.UTF_8), false);
        if (r.ok()) learnServerTime(r.json().optString("server_time", ""));
        return r;
    }

    /** GET /v1/manifest[?etag=..[&delta=1]]. 304 has an empty body. */
    Resp manifest(String heldEtag, boolean delta) {
        String path = "/v1/manifest";
        if (heldEtag != null && !heldEtag.isEmpty()) path += "?etag=" + heldEtag + (delta ? "&delta=1" : "");
        return call("GET", path, new byte[0], false);
    }

    /** POST /v1/events: caller guarantees 1..50 events and <= 16 KB. Duplicates are absorbed server side by event_id. */
    Resp events(String jsonBody) {
        return call("POST", "/v1/events", jsonBody.getBytes(StandardCharsets.UTF_8), false);
    }

    // ---------- signing (pure, testable) ----------

    static String canonical(String method, String pathAndQuery, long ts, String nonce, byte[] body) {
        return method + "\n" + pathAndQuery + "\n" + ts + "\n" + nonce + "\n" + sha256Hex(body);
    }

    String sign(String method, String pathAndQuery, long ts, String nonce, byte[] body) {
        byte[] msg = canonical(method, pathAndQuery, ts, nonce, body).getBytes(StandardCharsets.UTF_8);
        return b64u(keys.sign(msg));
    }

    // ---------- transport with the retry rules of DEVICE-PROTOCOL section 10 ----------

    Resp call(String method, String pathAndQuery, byte[] body, boolean registerCall) {
        boolean offsetAdjusted = false;
        Resp last = new Resp(0, "", "", "", 0, "network");
        for (int attempt = 0; attempt < MAX_QUICK_ATTEMPTS; attempt++) {
            last = exchange(method, pathAndQuery, body, registerCall);
            if (last.status == 401 && "stale_timestamp".equals(last.errorCode) && !offsetAdjusted) {
                long serverTime = last.json().optJSONObject("error") == null ? 0L
                    : last.json().optJSONObject("error").optJSONObject("details") == null ? 0L
                    : last.json().optJSONObject("error").optJSONObject("details").optLong("server_time", 0L);
                if (serverTime > 0) {
                    setClockOffset(serverTime - System.currentTimeMillis() / 1000L);
                    offsetAdjusted = true;
                    continue;                       // one retry with a corrected timestamp, new nonce
                }
                return last;
            }
            if (last.status == 409 && "replay".equals(last.errorCode)) continue;   // new nonce next loop
            if (last.status == 429 || last.status == 503) return last;              // caller sleeps Retry-After
            boolean retriable = last.status == 0 || last.status == 500 || last.status == 502 || last.status == 504;
            if (!retriable) return last;
            if (attempt < MAX_QUICK_ATTEMPTS - 1) sleep(backoffMs(attempt));
        }
        return last;
    }

    private Resp exchange(String method, String pathAndQuery, byte[] body, boolean registerCall) {
        HttpURLConnection conn = null;
        try {
            if (!allowCleartext && !baseUrl.startsWith("https://")) throw new IllegalStateException("Gateway phai dung HTTPS");
            long ts = nowMs() / 1000L;
            String nonce = b64u(randomBytes(16));
            String sig = sign(method, pathAndQuery, ts, nonce, body);
            conn = (HttpURLConnection) new URL(baseUrl + pathAndQuery).openConnection();
            conn.setInstanceFollowRedirects(false);    // never replay a signed request to another host
            conn.setConnectTimeout(CONNECT_MS);
            conn.setReadTimeout(READ_MS);
            conn.setRequestMethod(method);
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("X-Timestamp", Long.toString(ts));
            conn.setRequestProperty("X-Nonce", nonce);
            conn.setRequestProperty("X-Signature", sig);
            if (!registerCall) conn.setRequestProperty("X-Device-Id", deviceId());
            if ("POST".equals(method)) {
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                // No streaming mode on purpose: OpenJDK cannot read a 401 body in streaming mode (the error code would be lost).
                // The body is <= 16 KB, buffered, and the signed bytes are exactly the bytes written.
                try (OutputStream out = conn.getOutputStream()) { out.write(body); }
            }
            int status = conn.getResponseCode();
            InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String text = in == null ? "" : readLimited(in);
            long retryAfter = parseLong(conn.getHeaderField("Retry-After"));
            String errCode = "";
            if (status >= 400) {
                try {
                    JSONObject e = new JSONObject(text).optJSONObject("error");
                    if (e != null) errCode = e.optString("code", "");
                } catch (Exception ignored) { /* non-JSON error body (proxy page) */ }
            }
            return new Resp(status, text, unquote(conn.getHeaderField("ETag")), conn.getHeaderField("X-Manifest-Kind"), retryAfter, errCode);
        } catch (Exception networkOrSetup) {
            return new Resp(0, "", "", "", 0, "network");
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    // ---------- helpers ----------

    private void setClockOffset(long seconds) {
        clockOffsetS = seconds;
        prefs.edit().putLong(K_CLOCK_OFFSET, seconds).apply();
    }

    private void learnServerTime(String iso) {
        long ms = parseIsoMs(iso);
        if (ms > 0) {
            long off = ms / 1000L - System.currentTimeMillis() / 1000L;
            if (Math.abs(off - clockOffsetS) > 2) setClockOffset(off);
        }
    }

    /** DEVICE-PROTOCOL section 2: wait 0..60 s after boot before the first heartbeat (no connection storms). */
    long startupJitterMs() { return (long) (random.nextDouble() * 60_000d); }

    /** uniform(0, min(60 s, 1 s * 2^attempt)) = full jitter (section 10.2). */
    long backoffMs(int attempt) {
        return (long) (random.nextDouble() * Math.min(60_000L, 1000L << Math.min(attempt, 6)));
    }

    byte[] randomBytes(int n) { byte[] b = new byte[n]; random.nextBytes(b); return b; }

    static String b64u(byte[] data) {
        return Base64.encodeToString(data, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    static String sha256Hex(byte[] data) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(data);
            return hex(d);
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    static String hex(byte[] d) {
        char[] c = "0123456789abcdef".toCharArray();
        char[] out = new char[d.length * 2];
        for (int i = 0; i < d.length; i++) { out[i * 2] = c[(d[i] >> 4) & 15]; out[i * 2 + 1] = c[d[i] & 15]; }
        return new String(out);
    }

    static long parseIsoMs(String iso) {
        if (iso == null || iso.isEmpty()) return 0L;
        String[] patterns = {"yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'"};
        for (String p : patterns) {
            try {
                SimpleDateFormat f = new SimpleDateFormat(p, Locale.US);
                f.setTimeZone(TimeZone.getTimeZone("UTC"));
                Date d = f.parse(iso);
                if (d != null) return d.getTime();
            } catch (Exception ignored) { /* try next pattern */ }
        }
        return 0L;
    }

    static String isoUtc(long ms) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date(ms));
    }

    private static String readLimited(InputStream in) throws Exception {
        try (InputStream s = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = s.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > MAX_RESPONSE_BYTES) throw new java.io.IOException("response too large");
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static long parseLong(String v) {
        try { return v == null ? 0L : Long.parseLong(v.trim()); } catch (Exception e) { return 0L; }
    }

    private static String unquote(String etag) {
        if (etag == null) return "";
        String t = etag.trim();
        if (t.startsWith("W/")) t = t.substring(2);
        if (t.length() >= 2 && t.startsWith("\"") && t.endsWith("\"")) t = t.substring(1, t.length() - 1);
        return t;
    }

    private static String clip(String s, int max) { return s.length() <= max ? s : s.substring(0, max); }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }
}
