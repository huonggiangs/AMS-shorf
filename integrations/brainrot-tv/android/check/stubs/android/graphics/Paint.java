package android.graphics;
public class Paint {
    public static final int ANTI_ALIAS_FLAG = 1;
    public enum Style { FILL, STROKE }
    public enum Cap { ROUND }
    public Paint(int flags) { }
    public void setColor(int c) { } public void setStyle(Style s) { } public void setStrokeWidth(float w) { } public void setStrokeCap(Cap c) { }
}
