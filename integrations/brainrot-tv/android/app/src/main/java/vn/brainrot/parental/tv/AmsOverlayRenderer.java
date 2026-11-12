package vn.brainrot.parental.tv;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.MultiFormatWriter;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;

import java.io.File;
import java.util.EnumMap;
import java.util.Map;

/**
 * Renders a validated creative.overlay onto plain Android views, in the same programmatic style as
 * TvOverlayController (no XML, no new dependencies: ZXing core is already in app/build.gradle).
 *
 * Layout regions follow assets/formats/ADS.png (see docs/TV-APP-INTEGRATION.md section 4.3):
 *   top row   : sponsor_tag chip . badges[] chips . brand_label chip
 *   below     : "SCTE-35 ID #" + scte_id (small caption), headline card (serif, <= 2 lines)
 *   bottom row: hotline card (label / number / sub) . QR block (label / title / hint)
 *   backdrop  : background image (center-crop) with a dark scrim
 * LOCK_SPLIT renders only the left AD zone (LOCK_AD_FRACTION of the screen width); the parental lock panel keeps
 * the rest and is drawn by TvOverlayController. All sizes are authored for 1080 px height and scaled by H/1080,
 * so the same code is correct from HD to 8K output.
 *
 * Must be called on the main thread (views). Bitmaps are decoded by the caller's worker thread via decodeBackground().
 */
final class AmsOverlayRenderer {
    enum Layout { LOCK_SPLIT, FULL, CORNER_CARD }

    /** Share of the screen width given to the ad in LOCK_SPLIT (ADS.png: lock panel starts at ~68.4%, so keep 31% free). */
    static final float LOCK_AD_FRACTION = 0.69f;

    private static final int SCRIM = 0x99081226;
    private static final int CARD_BG = 0xCC0A1630;
    private static final int CARD_LINE = 0x33FFFFFF;
    private static final int INK = 0xFFE6ECFB;
    private static final int MUTED = 0xFFA9B6D1;
    private static final int ACCENT = 0xFF8CCBFF;
    private static final int DOT = 0xFF1E9BFF;
    private static final int GREEN = 0xFF3DDC97;
    private static final int AMBER = 0xFFFFB454;
    private static final int BRAND_BG = 0xFF1B3A63;
    private static final int BRAND_INK = 0xFFA8D1FF;
    private static final int QR_TILE = 0xFFFFFFFF;

    private AmsOverlayRenderer() { }

    /** Decode the cached background with a sample size that keeps memory low on 1-2 GB TVs (RGB_565). */
    static Bitmap decodeBackground(File file, int targetW, int targetH) {
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(file.getPath(), bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
            int sample = 1;
            while (bounds.outWidth / (sample * 2) >= targetW && bounds.outHeight / (sample * 2) >= targetH) sample *= 2;
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            opts.inPreferredConfig = Bitmap.Config.RGB_565;
            return BitmapFactory.decodeFile(file.getPath(), opts);
        } catch (Throwable oom) {
            return null;
        }
    }

    static View build(Context ctx, AmsOverlaySpec s, Bitmap background, Layout layout, int widthPx, int heightPx) {
        float u = heightPx / 1080f;
        FrameLayout root = new FrameLayout(ctx);
        root.setLayoutParams(new ViewGroup.LayoutParams(widthPx, heightPx));
        root.setBackgroundColor(0xFF08152E);
        if (layout == Layout.CORNER_CARD) {
            buildCornerCard(ctx, root, s, u, widthPx, heightPx);
            return root;
        }
        if (background != null) {
            ImageView bg = new ImageView(ctx);
            bg.setScaleType(ImageView.ScaleType.CENTER_CROP);
            bg.setImageBitmap(background);
            root.addView(bg, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        View scrim = new View(ctx);
        scrim.setBackgroundColor(SCRIM);
        root.addView(scrim, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout column = new LinearLayout(ctx);
        column.setOrientation(LinearLayout.VERTICAL);
        int padL = widthPx * s.safeLeft / 100;
        int padR = widthPx * s.safeRight / 100;
        int padT = heightPx * s.safeTop / 100;
        int padB = heightPx * s.safeBottom / 100;
        column.setPadding(padL, padT, padR, padB);
        root.addView(column, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // --- top row: sponsor tag . badges . brand ---
        LinearLayout top = new LinearLayout(ctx);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        if (!s.sponsorTag.isEmpty()) top.addView(chip(ctx, u, s.sponsorTag, ACCENT, 0x401E9BFF, 0, true, true), wrap(0, 0, (int) (10 * u), 0));
        for (String badge : s.badges) top.addView(chip(ctx, u, badge, INK, 0x33FFFFFF, 0, false, false), wrap(0, 0, (int) (10 * u), 0));
        if (!s.brandLabel.isEmpty()) top.addView(chip(ctx, u, s.brandLabel, BRAND_INK, BRAND_BG, 0, false, true), wrap(0, 0, 0, 0));
        column.addView(top, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        if (!s.scteId.isEmpty()) {
            TextView scte = text(ctx, "SCTE-35 ID #" + s.scteId, 15 * u, MUTED, false);
            scte.setSingleLine(true);
            column.addView(scte, wrap(0, (int) (10 * u), 0, 0));
        }

        // --- headline card ---
        TextView headline = text(ctx, s.headline, (layout == Layout.FULL ? 46 : 40) * u, INK, true);
        headline.setTypeface(Typeface.SERIF, Typeface.BOLD);
        headline.setMaxLines(2);
        headline.setEllipsize(TextUtils.TruncateAt.END);
        headline.setLineSpacing(4 * u, 1f);
        headline.setPadding((int) (18 * u), (int) (14 * u), (int) (18 * u), (int) (14 * u));
        headline.setBackground(rounded(CARD_BG, 10 * u, CARD_LINE, Math.max(1, (int) u)));
        if (!s.headline.isEmpty()) column.addView(headline, wrap(0, (int) (10 * u), 0, 0));

        // --- spacer ---
        column.addView(new View(ctx), new LinearLayout.LayoutParams(0, 0, 1f));

        // --- bottom row: hotline card . QR block ---
        LinearLayout bottom = new LinearLayout(ctx);
        bottom.setOrientation(LinearLayout.HORIZONTAL);
        bottom.setGravity(Gravity.BOTTOM);
        if (!s.hotlineNumber.isEmpty()) bottom.addView(hotlineCard(ctx, u, s), wrap(0, 0, (int) (24 * u), 0));
        if (!s.qrUrl.isEmpty()) bottom.addView(qrBlock(ctx, u, s, 150), wrap(0, 0, 0, 0));
        column.addView(bottom, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return root;
    }

    private static void buildCornerCard(Context ctx, FrameLayout root, AmsOverlaySpec s, float u, int widthPx, int heightPx) {
        root.setBackgroundColor(0x00000000);
        LinearLayout card = new LinearLayout(ctx);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding((int) (20 * u), (int) (16 * u), (int) (20 * u), (int) (16 * u));
        card.setBackground(rounded(CARD_BG, 12 * u, CARD_LINE, Math.max(1, (int) u)));
        if (!s.sponsorTag.isEmpty()) card.addView(chip(ctx, u, s.sponsorTag, ACCENT, 0x401E9BFF, 0, true, true), wrap(0, 0, 0, (int) (8 * u)));
        TextView headline = text(ctx, s.headline, 26 * u, INK, true);
        headline.setMaxLines(2);
        headline.setEllipsize(TextUtils.TruncateAt.END);
        if (!s.headline.isEmpty()) card.addView(headline, wrap(0, 0, 0, (int) (10 * u)));
        if (!s.qrUrl.isEmpty()) card.addView(qrBlock(ctx, u, s, 120), wrap(0, 0, 0, 0));
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams((int) (widthPx * 0.30f), ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM | Gravity.RIGHT);
        lp.rightMargin = widthPx * s.safeRight / 100;
        lp.bottomMargin = heightPx * s.safeBottom / 100;
        root.addView(card, lp);
    }

    private static View hotlineCard(Context ctx, float u, AmsOverlaySpec s) {
        LinearLayout card = new LinearLayout(ctx);
        card.setOrientation(LinearLayout.HORIZONTAL);
        card.setGravity(Gravity.CENTER_VERTICAL);
        card.setPadding((int) (14 * u), (int) (14 * u), (int) (22 * u), (int) (14 * u));
        card.setBackground(rounded(CARD_BG, 10 * u, CARD_LINE, Math.max(1, (int) u)));
        PhoneGlyph glyph = new PhoneGlyph(ctx);
        glyph.setBackground(rounded(0xFF1D3350, 10 * u, 0, 0));
        card.addView(glyph, new LinearLayout.LayoutParams((int) (80 * u), (int) (80 * u)));
        LinearLayout copy = new LinearLayout(ctx);
        copy.setOrientation(LinearLayout.VERTICAL);
        if (!s.hotlineLabel.isEmpty()) copy.addView(text(ctx, s.hotlineLabel.toUpperCase(java.util.Locale.ROOT), 15 * u, MUTED, true), wrap(0, 0, 0, 0));
        TextView number = text(ctx, s.hotlineNumber, 40 * u, ACCENT, true);
        number.setSingleLine(true);
        copy.addView(number, wrap(0, (int) (2 * u), 0, 0));
        if (!s.hotlineSub.isEmpty()) {
            TextView sub = text(ctx, "● " + s.hotlineSub, 16 * u, GREEN, false);
            copy.addView(sub, wrap(0, (int) (2 * u), 0, 0));
        }
        card.addView(copy, wrap((int) (16 * u), 0, 0, 0));
        return card;
    }

    private static View qrBlock(Context ctx, float u, AmsOverlaySpec s, int sizeDp) {
        LinearLayout block = new LinearLayout(ctx);
        block.setOrientation(LinearLayout.HORIZONTAL);
        block.setGravity(Gravity.CENTER_VERTICAL);
        int px = (int) (sizeDp * u);
        ImageView qr = new ImageView(ctx);
        qr.setBackgroundColor(QR_TILE);
        qr.setPadding((int) (6 * u), (int) (6 * u), (int) (6 * u), (int) (6 * u));
        Bitmap bmp = qrBitmap(s.qrUrl, px);
        if (bmp != null) qr.setImageBitmap(bmp);
        block.addView(qr, new LinearLayout.LayoutParams(px, px));
        LinearLayout copy = new LinearLayout(ctx);
        copy.setOrientation(LinearLayout.VERTICAL);
        if (!s.qrLabel.isEmpty()) copy.addView(text(ctx, s.qrLabel.toUpperCase(java.util.Locale.ROOT), 16 * u, AMBER, true), wrap(0, 0, 0, 0));
        TextView title = text(ctx, s.qrTitle, 30 * u, INK, true);
        title.setSingleLine(true);
        if (!s.qrTitle.isEmpty()) copy.addView(title, wrap(0, (int) (2 * u), 0, 0));
        if (!s.qrHint.isEmpty()) copy.addView(text(ctx, s.qrHint, 16 * u, MUTED, false), wrap(0, (int) (4 * u), 0, 0));
        block.addView(copy, wrap((int) (14 * u), 0, 0, 0));
        return block;
    }

    /** ZXing QR, black on white, quiet zone of 1 module. Keep qr.url short (<= ~60 chars): a 150 px tile must stay scannable. */
    static Bitmap qrBitmap(String url, int px) {
        try {
            Map<EncodeHintType, Object> hints = new EnumMap<>(EncodeHintType.class);
            hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M);
            hints.put(EncodeHintType.MARGIN, 1);
            BitMatrix m = new MultiFormatWriter().encode(url, BarcodeFormat.QR_CODE, px, px, hints);
            int[] pixels = new int[px * px];
            for (int y = 0; y < px; y++) for (int x = 0; x < px; x++) pixels[y * px + x] = m.get(x, y) ? 0xFF0B1220 : 0xFFFFFFFF;
            return Bitmap.createBitmap(pixels, px, px, Bitmap.Config.ARGB_8888);
        } catch (Exception e) {
            return null;
        }
    }

    // ---------- small view helpers ----------

    private static TextView chip(Context ctx, float u, String label, int ink, int fill, int stroke, boolean dot, boolean bold) {
        TextView t = text(ctx, (dot ? "●  " : "") + label, 20 * u, ink, bold);
        t.setSingleLine(true);
        t.setPadding((int) (16 * u), (int) (8 * u), (int) (16 * u), (int) (8 * u));
        t.setBackground(rounded(fill, 8 * u, stroke, stroke == 0 ? 0 : Math.max(1, (int) u)));
        return t;
    }

    private static TextView text(Context ctx, String value, float sizePx, int color, boolean bold) {
        TextView t = new TextView(ctx);
        t.setText(value);
        t.setTextColor(color);
        t.setTextSize(TypedValue.COMPLEX_UNIT_PX, sizePx);
        t.setTypeface(Typeface.DEFAULT, bold ? Typeface.BOLD : Typeface.NORMAL);
        t.setIncludeFontPadding(false);
        return t;
    }

    private static GradientDrawable rounded(int fill, float radiusPx, int stroke, int strokePx) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(fill);
        d.setCornerRadius(radiusPx);
        if (strokePx > 0) d.setStroke(strokePx, stroke);
        return d;
    }

    private static LinearLayout.LayoutParams wrap(int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(left, top, right, bottom);
        return lp;
    }

    /** Handset glyph drawn with a stroked arc, so no icon font or drawable resource is needed on the TV. */
    private static final class PhoneGlyph extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

        PhoneGlyph(Context ctx) { super(ctx); }

        @Override protected void onDraw(Canvas canvas) {
            float w = getWidth();
            float h = getHeight();
            paint.setColor(ACCENT);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(w * 0.13f);
            paint.setStrokeCap(Paint.Cap.ROUND);
            RectF arc = new RectF(w * 0.30f, h * 0.22f, w * 0.78f, h * 0.70f);
            canvas.drawArc(arc, 160f, 130f, false, paint);
            paint.setStyle(Paint.Style.FILL);
            canvas.drawCircle(w * 0.32f, h * 0.66f, w * 0.085f, paint);
            canvas.drawCircle(w * 0.74f, h * 0.28f, w * 0.085f, paint);
        }
    }
}
