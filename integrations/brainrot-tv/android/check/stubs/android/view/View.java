package android.view;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
public class View {
    public View(Context c) { }
    public void setBackgroundColor(int c) { } public void setBackground(Drawable d) { }
    public void setLayoutParams(ViewGroup.LayoutParams lp) { } public void setPadding(int l, int t, int r, int b) { }
    protected void onDraw(Canvas c) { } public int getWidth() { return 0; } public int getHeight() { return 0; }
}
