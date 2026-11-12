package android.content;
import android.content.pm.PackageManager;
import android.content.res.Resources;
import java.io.File;
public abstract class Context {
    public static final int MODE_PRIVATE = 0;
    public static final String CONNECTIVITY_SERVICE = "connectivity";
    public static final String WIFI_SERVICE = "wifi";
    public static final String POWER_SERVICE = "power";
    public abstract SharedPreferences getSharedPreferences(String name, int mode);
    public abstract Context getApplicationContext();
    public abstract File getFilesDir();
    public abstract File getNoBackupFilesDir();
    public abstract PackageManager getPackageManager();
    public abstract String getPackageName();
    public abstract Resources getResources();
    public abstract Object getSystemService(String name);
}
