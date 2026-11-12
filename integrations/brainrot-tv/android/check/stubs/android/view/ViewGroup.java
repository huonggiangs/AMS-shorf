package android.view;
public class ViewGroup extends View {
    public ViewGroup(android.content.Context c) { super(c); }
    public static class LayoutParams { public static final int MATCH_PARENT = -1, WRAP_CONTENT = -2; public int width, height; public LayoutParams(int w, int h) { width = w; height = h; } }
    public static class MarginLayoutParams extends LayoutParams {
        public int leftMargin, topMargin, rightMargin, bottomMargin;
        public MarginLayoutParams(int w, int h) { super(w, h); }
        public void setMargins(int l, int t, int r, int b) { leftMargin = l; topMargin = t; rightMargin = r; bottomMargin = b; }
    }
    public void addView(View v, LayoutParams lp) { }
}
