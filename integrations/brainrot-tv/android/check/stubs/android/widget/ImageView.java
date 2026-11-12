package android.widget;
import android.content.Context;
import android.graphics.Bitmap;
import android.view.View;
public class ImageView extends View {
    public enum ScaleType { CENTER_CROP }
    public ImageView(Context c) { super(c); }
    public void setScaleType(ScaleType t) { } public void setImageBitmap(Bitmap b) { }
}
