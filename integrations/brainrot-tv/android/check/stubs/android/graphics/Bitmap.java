package android.graphics;
public class Bitmap {
    public enum Config { ARGB_8888, RGB_565 }
    public static Bitmap createBitmap(int[] c, int w, int h, Config cfg) { return new Bitmap(); }
    public boolean isRecycled() { return false; }
    public void recycle() { }
}
