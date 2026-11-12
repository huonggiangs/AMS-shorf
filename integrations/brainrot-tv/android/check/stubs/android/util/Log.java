package android.util;
public final class Log {
    public static int w(String t, String m, Throwable e) { System.err.println("W/" + t + ": " + m + " " + e); return 0; }
    public static int w(String t, String m) { System.err.println("W/" + t + ": " + m); return 0; }
    public static int i(String t, String m) { System.err.println("I/" + t + ": " + m); return 0; }
}
