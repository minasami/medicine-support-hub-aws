package com.medicinesupporthub.app

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import com.getcapacitor.BridgeActivity
import io.appwrite.Client
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.File

/**
 * Play APK updates preserve app data. An older PWA service worker registered for
 * https://localhost (Capacitor default) can keep serving stale index.html / JS
 * chunks from Cache Storage and the HTTP disk cache — so new JS that would
 * unregister the SW never executes (blank white / stuck boot screen).
 *
 * On versionCode change we wipe WebView profile dirs once **before** Bridge
 * loads packaged assets. Do NOT clearCache / WebStorage.deleteAllData() after
 * super.onCreate — that races the in-flight module load and can leave the
 * already-painted HTML boot UI stuck forever while React never mounts.
 *
 * Hostname change (app.medicinesupport.local) + pre-Bridge filesystem wipe is
 * enough; live Document must stay untouched after Bridge starts.
 */
class MainActivity : BridgeActivity() {
    companion object {
        private const val TAG = "MshCacheBust"
        private const val PREFS = "msh_native_prefs"
        private const val KEY_LAST_CLEARED_VC = "last_cleared_version_code"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        maybeClearWebCachesOnUpgrade()
        super.onCreate(savedInstanceState)

        // Keep Android SDK endpoint aligned with the JS client (custom domain).
        val client = Client(applicationContext)
            .setEndpoint("https://appwrite.medicinesupport.app/v1")
            .setProject("6a54ac3a00272c02d6e0")

        CoroutineScope(Dispatchers.IO).launch {
            try {
                client.ping()
                Log.d("AppwriteSDK", "Appwrite Android SDK ping ok")
            } catch (e: Exception) {
                Log.w("AppwriteSDK", "Appwrite ping notice: ${e.message}")
            }
        }
    }

    private fun currentVersionCode(): Long {
        return try {
            val info = packageManager.getPackageInfo(packageName, 0)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                info.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                info.versionCode.toLong()
            }
        } catch (e: PackageManager.NameNotFoundException) {
            Log.w(TAG, "versionCode lookup failed: ${e.message}")
            0L
        }
    }

    private fun maybeClearWebCachesOnUpgrade() {
        val vc = currentVersionCode()
        if (vc <= 0L) return

        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val last = prefs.getLong(KEY_LAST_CLEARED_VC, -1L)
        if (last == vc) return

        Log.i(TAG, "versionCode $last → $vc: clearing WebView dirs before Bridge load (no live clear)")
        try {
            deleteDirQuiet(cacheDir)
            deleteDirQuiet(codeCacheDir)
            // Chromium WebView profile under app data (Service Worker, Cache, cookies on disk)
            deleteDirQuiet(File(applicationInfo.dataDir, "app_webview"))
            deleteDirQuiet(File(applicationInfo.dataDir, "webview"))
            deleteDirQuiet(File(applicationInfo.dataDir, "app_textures"))
            deleteDirQuiet(File(cacheDir, "WebView"))
            deleteDirQuiet(File(filesDir, "WebView"))
        } catch (e: Exception) {
            Log.w(TAG, "filesystem cache wipe notice: ${e.message}")
        }

        // Record only after pre-Bridge wipe. Never set a post-Bridge clear flag —
        // clearCache / WebStorage.deleteAllData() after Bridge aborts module load.
        prefs.edit().putLong(KEY_LAST_CLEARED_VC, vc).apply()
    }

    private fun deleteDirQuiet(dir: File?) {
        if (dir == null || !dir.exists()) return
        try {
            dir.deleteRecursively()
        } catch (e: Exception) {
            Log.w(TAG, "delete ${dir.absolutePath}: ${e.message}")
        }
    }
}
