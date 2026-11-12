package android.widget;
import android.content.Context;
import android.graphics.Typeface;
import android.text.TextUtils;
import android.view.View;
public class TextView extends View {
    public TextView(Context c) { super(c); }
    public void setText(CharSequence t) { } public void setTextColor(int c) { } public void setTextSize(int unit, float s) { }
    public void setTypeface(Typeface t, int style) { } public void setTypeface(Typeface t) { } public void setIncludeFontPadding(boolean b) { }
    public void setSingleLine(boolean b) { } public void setMaxLines(int n) { } public void setEllipsize(TextUtils.TruncateAt w) { }
    public void setLineSpacing(float add, float mult) { }
}
