package android.os;
public class Handler {
    public Handler(Looper l) { }
    public boolean post(Runnable r) { return true; }
    public boolean postDelayed(Runnable r, long ms) { return true; }
    public void removeCallbacks(Runnable r) { }
    public void removeCallbacksAndMessages(Object o) { }
}
