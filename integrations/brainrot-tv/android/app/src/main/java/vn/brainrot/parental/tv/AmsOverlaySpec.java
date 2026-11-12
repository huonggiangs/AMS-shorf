package vn.brainrot.parental.tv;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Parsed and validated {@code creative.overlay} (schema v1, see docs/TV-APP-INTEGRATION.md section 4 and
 * integrations/brainrot-tv/schema/overlay.ts). Pure Java + org.json: no Android views, so it can be unit-tested
 * on a JVM. The server validates the same rules (zod); the client validates again because the manifest is only
 * protected by TLS, and a malformed overlay must never crash the foreground service.
 */
final class AmsOverlaySpec {
    static final int VERSION = 1;
    static final String CTX_LOCK = "lock";
    static final String CTX_FULLSCREEN = "fullscreen";
    static final String CTX_PAUSE = "pause";
    static final String CTX_CORNER = "corner";
    private static final Set<String> ALL_CONTEXTS = Collections.unmodifiableSet(new LinkedHashSet<>(
        java.util.Arrays.asList(CTX_LOCK, CTX_FULLSCREEN, CTX_PAUSE, CTX_CORNER)));

    private static final Pattern SHA256 = Pattern.compile("^[0-9a-f]{64}$");
    private static final Pattern HTTPS_URL = Pattern.compile("^https://[A-Za-z0-9.-]+(:[0-9]{2,5})?(/[^\\s]*)?$");
    private static final Pattern PHONE = Pattern.compile("^[0-9 .+()-]{6,20}$");
    private static final Pattern SCTE = Pattern.compile("^[A-Z0-9][A-Z0-9-]{2,38}$");

    final String sponsorTag;
    final String brandLabel;
    final String headline;
    final String scteId;            // may be ""
    final List<String> badges;
    final String hotlineLabel;      // "" when no hotline
    final String hotlineNumber;
    final String hotlineSub;
    final String qrUrl;             // "" when no QR
    final String qrLabel;
    final String qrTitle;
    final String qrHint;
    final String bgUrl;
    final String bgSha256;
    final int bgW;
    final int bgH;
    final int safeTop;
    final int safeRight;
    final int safeBottom;
    final int safeLeft;
    final int durationS;
    final boolean kidSafe;
    final Set<String> contexts;

    private AmsOverlaySpec(JSONObject o, JSONObject creative) {
        if (o.optInt("v", -1) != VERSION) throw new IllegalArgumentException("overlay.v phai bang 1");
        sponsorTag = text(o, "sponsor_tag", 1, 40, true);
        brandLabel = text(o, "brand_label", 1, 24, true);
        headline = text(o, "headline", 1, 90, true);
        scteId = scte(o.optString("scte_id", ""));

        List<String> b = new ArrayList<>();
        JSONArray badgeArr = o.optJSONArray("badges");
        if (badgeArr != null) {
            if (badgeArr.length() > 3) throw new IllegalArgumentException("badges toi da 3");
            for (int i = 0; i < badgeArr.length(); i++) b.add(clean(badgeArr.optString(i, ""), 1, 30, "badges[" + i + "]"));
        }
        badges = Collections.unmodifiableList(b);

        JSONObject hotline = o.optJSONObject("hotline");
        if (hotline != null) {
            hotlineLabel = text(hotline, "label", 1, 40, true);
            hotlineNumber = clean(hotline.optString("number", ""), 6, 20, "hotline.number");
            if (!PHONE.matcher(hotlineNumber).matches()) throw new IllegalArgumentException("hotline.number sai dinh dang");
            hotlineSub = text(hotline, "sub", 1, 40, false);
        } else {
            hotlineLabel = ""; hotlineNumber = ""; hotlineSub = "";
        }

        JSONObject qr = o.optJSONObject("qr");
        if (qr != null) {
            qrUrl = qr.optString("url", "");
            if (qrUrl.length() > 120 || !HTTPS_URL.matcher(qrUrl).matches()) throw new IllegalArgumentException("qr.url phai la https, <=120 ky tu");
            qrLabel = text(qr, "label", 1, 40, false);
            qrTitle = text(qr, "title", 1, 30, true);
            qrHint = text(qr, "hint", 1, 40, false);
        } else {
            qrUrl = ""; qrLabel = ""; qrTitle = ""; qrHint = "";
        }

        JSONObject bg = o.optJSONObject("background");
        String url = bg != null ? bg.optString("url", "") : creative.optString("url", "");
        String sha = bg != null ? bg.optString("sha256", "") : creative.optString("sha256", "");
        int w = bg != null ? bg.optInt("px_w", 0) : creative.optInt("px_w", 0);
        int h = bg != null ? bg.optInt("px_h", 0) : creative.optInt("px_h", 0);
        if (!HTTPS_URL.matcher(url).matches()) throw new IllegalArgumentException("background.url phai la https");
        if (!SHA256.matcher(sha).matches()) throw new IllegalArgumentException("background.sha256 sai dinh dang");
        if (w < 1280 || h < 720 || Math.abs((long) w * 9 - (long) h * 16) > 16) {
            throw new IllegalArgumentException("background phai 16:9 va >= 1280x720");
        }
        bgUrl = url; bgSha256 = sha; bgW = w; bgH = h;

        JSONObject safe = o.optJSONObject("safe_area");
        safeTop = pct(safe, "top"); safeRight = pct(safe, "right"); safeBottom = pct(safe, "bottom"); safeLeft = pct(safe, "left");

        int d = o.optInt("duration_s", 15);
        if (d < 5 || d > 60) throw new IllegalArgumentException("duration_s phai trong 5..60");
        durationS = d;
        kidSafe = o.optBoolean("kid_safe", false);

        Set<String> ctx = new LinkedHashSet<>();
        JSONArray ctxArr = o.optJSONArray("contexts");
        if (ctxArr == null) ctx.add(CTX_FULLSCREEN);
        else for (int i = 0; i < ctxArr.length(); i++) {
            String c = ctxArr.optString(i, "");
            if (!ALL_CONTEXTS.contains(c)) throw new IllegalArgumentException("contexts[" + i + "] khong hop le");
            ctx.add(c);
        }
        if (ctx.isEmpty()) throw new IllegalArgumentException("contexts khong duoc rong");
        contexts = Collections.unmodifiableSet(ctx);
    }

    /** @param creative the manifest creative (fallback source for background when overlay.background is absent). */
    static AmsOverlaySpec parse(JSONObject overlay, JSONObject creative) {
        if (overlay == null) throw new IllegalArgumentException("khong co overlay");
        return new AmsOverlaySpec(overlay, creative == null ? new JSONObject() : creative);
    }

    boolean allows(String context) { return contexts.contains(context); }

    private static int pct(JSONObject safe, String key) {
        int v = safe == null ? 5 : safe.optInt(key, 5);
        if (v < 0 || v > 15) throw new IllegalArgumentException("safe_area." + key + " phai trong 0..15");
        return v;
    }

    private static String scte(String v) {
        if (v == null || v.isEmpty()) return "";
        if (!SCTE.matcher(v).matches()) throw new IllegalArgumentException("scte_id sai dinh dang");
        return v;
    }

    private static String text(JSONObject o, String key, int min, int max, boolean required) {
        Object raw = o.opt(key);
        if (raw == null || JSONObject.NULL.equals(raw) || "".equals(raw)) {
            if (required) throw new IllegalArgumentException(key + " bat buoc");
            return "";
        }
        if (!(raw instanceof String)) throw new IllegalArgumentException(key + " phai la chuoi");
        return clean((String) raw, min, max, key);
    }

    private static String clean(String s, int min, int max, String name) {
        if (s == null) s = "";
        String t = s.trim();
        if (t.length() < min || t.length() > max) throw new IllegalArgumentException(name + " dai " + min + ".." + max + " ky tu");
        for (int i = 0; i < t.length(); i++) {
            if (Character.isISOControl(t.charAt(i))) throw new IllegalArgumentException(name + " chua ky tu dieu khien");
        }
        return t;
    }
}
