package com.wz.reader;

import android.app.Activity;
import android.app.Service;
import android.content.Intent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.IBinder;
import java.io.InputStream;
import java.security.MessageDigest;

// The recipient runs under the test APK's separate UID, without the app's Kotlin runtime.
public class DelayedDiagnosticReceiverActivity extends Activity {
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    Uri uri = getIntent().getParcelableExtra(Intent.EXTRA_STREAM);
    if (uri == null) throw new IllegalStateException("Missing shared URI");
    // Forward only the received temporary grant using Android's normal Service Intent.
    // Its lifetime lasts until stopSelf; no artificial provider grant is installed.
    startService(new Intent(this, ReaderService.class).setData(uri)
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
    finish();
  }

  public static class ReaderService extends Service {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private BroadcastReceiver proceed;
    private boolean scheduled;

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
      Uri uri = intent.getData();
      proceed = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent signal) {
          if (scheduled) return;
          scheduled = true;
          // The host sends this only after the actual shareAsync Promise has resolved.
          handler.postDelayed(() -> readSharedFile(uri, startId), 3000);
        }
      };
      registerReceiver(proceed, new IntentFilter("com.wz.reader.PLATFORM_DIAGNOSTIC_READ"), Context.RECEIVER_EXPORTED);
      handler.postDelayed(() -> stopSelf(startId), 30000);
      return START_NOT_STICKY;
    }

    private void readSharedFile(Uri uri, int startId) {
      String result;
      try {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long bytes = 0;
        try (InputStream input = getContentResolver().openInputStream(uri)) {
          if (input == null) throw new IllegalStateException("Missing shared stream");
          byte[] buffer = new byte[32 * 1024];
          int count;
          while ((count = input.read(buffer)) != -1) {
            bytes += count;
            digest.update(buffer, 0, count);
          }
        }
        StringBuilder hash = new StringBuilder();
        for (byte value : digest.digest()) hash.append(String.format(java.util.Locale.ROOT, "%02x", value));
        result = "READ_OK\n" + bytes + "\n" + hash;
      } catch (Exception error) {
        result = "READ_FAILED\n" + error.getClass().getSimpleName() + ":" + error.getMessage();
      }
      sendBroadcast(new Intent("com.wz.reader.PLATFORM_DIAGNOSTIC_RECEIVED")
        .setPackage("com.wz.reader").putExtra("result", result));
      stopSelf(startId);
    }

    @Override public void onDestroy() {
      if (proceed != null) unregisterReceiver(proceed);
      handler.removeCallbacksAndMessages(null);
      super.onDestroy();
    }
  }
}
