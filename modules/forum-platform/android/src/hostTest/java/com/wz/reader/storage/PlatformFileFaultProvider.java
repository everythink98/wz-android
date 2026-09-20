package com.wz.reader;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Binder;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.ParcelFileDescriptor;
import android.os.ProxyFileDescriptorCallback;
import android.os.storage.StorageManager;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructTimeval;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

// This provider is packaged only in androidTest. It owns no user documents or real disk quota.
// Java keeps its separate test-APK process independent of the target app's Kotlin runtime.
public final class PlatformFileFaultProvider extends ContentProvider {
  public static final String AUTHORITY = "com.wz.reader.test.file-faults";
  public static final int QUOTA_BYTES = 8192;
  public static final int CLOSE_ERROR_BYTES = 32768;
  private final ConcurrentHashMap<String, Transfer> transfers = new ConcurrentHashMap<>();

  private static final class Transfer {
    final HandlerThread thread = new HandlerThread("owned-provider-fault");
    final CountDownLatch remoteError = new CountDownLatch(1);
    volatile long bytes;
    volatile int writeErrors;
    volatile boolean released;
    volatile boolean closeErrorReported;
    volatile String workerError;
    ParcelFileDescriptor peer;
    Transfer() { thread.start(); }
    void dispose() {
      if (peer != null) try { peer.close(); } catch (IOException ignored) { }
      thread.quitSafely();
      try { thread.join(11000); }
      catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IllegalStateException(error); }
      if (thread.isAlive()) throw new IllegalStateException("Owned provider worker did not stop");
    }
  }

  public static Uri newUri(String mode) {
    return Uri.parse("content://" + AUTHORITY + "/" + UUID.randomUUID().toString().replace("-", "") + "/" + mode);
  }

  private void requireProofCaller() {
    int uid = Binder.getCallingUid();
    if (uid == android.os.Process.myUid()) return;
    try {
      PackageManager pm = getContext().getPackageManager();
      if (uid == pm.getApplicationInfo("com.wz.reader", 0).uid
          && pm.checkSignatures(uid, android.os.Process.myUid()) == PackageManager.SIGNATURE_MATCH) return;
    } catch (PackageManager.NameNotFoundException ignored) { }
    throw new SecurityException("Only the matching instrumented app may use this test provider");
  }

  private String token(Uri uri) {
    requireProofCaller();
    if (!AUTHORITY.equals(uri.getAuthority()) || uri.getPathSegments().size() != 2
        || !uri.getPathSegments().get(0).matches("[a-f0-9]{32}")) throw new IllegalArgumentException("Invalid proof URI");
    return uri.getPathSegments().get(0);
  }

  @Override public boolean onCreate() { return true; }
  @Override public String getType(Uri uri) { token(uri); return "application/json"; }

  @Override public ParcelFileDescriptor openFile(Uri uri, String access) throws FileNotFoundException {
    String token = token(uri);
    String mode = uri.getLastPathSegment();
    if (!"wt".equals(access) || !("enospc".equals(mode) || "eio".equals(mode) || "close-error".equals(mode))) {
      throw new FileNotFoundException("Unsupported proof mode");
    }
    Transfer state = new Transfer();
    if (transfers.putIfAbsent(token, state) != null) {
      state.dispose();
      throw new FileNotFoundException("Proof token already opened");
    }
    try {
      if ("close-error".equals(mode)) {
        ParcelFileDescriptor[] pair = ParcelFileDescriptor.createReliableSocketPair();
        state.peer = pair[1];
        try {
          Os.setsockoptTimeval(state.peer.getFileDescriptor(), OsConstants.SOL_SOCKET, OsConstants.SO_RCVTIMEO,
              StructTimeval.fromMillis(10000));
        } catch (ErrnoException error) { pair[0].close(); throw new IOException(error); }
        new Handler(state.thread.getLooper()).post(() -> {
          try (ParcelFileDescriptor.AutoCloseInputStream input = new ParcelFileDescriptor.AutoCloseInputStream(state.peer)) {
            byte[] buffer = new byte[4096];
            while (state.bytes < CLOSE_ERROR_BYTES) {
              int count = input.read(buffer, 0, (int) Math.min(buffer.length, CLOSE_ERROR_BYTES - state.bytes));
              if (count < 0) throw new IOException("Writer ended before the complete proof payload");
              state.bytes += count;
            }
            state.peer.closeWithError("provider-close-proof");
            state.closeErrorReported = true;
          } catch (IOException error) {
            state.workerError = error.toString();
          } finally {
            state.remoteError.countDown();
            state.thread.quitSafely();
          }
        });
        return pair[0];
      }
      return getContext().getSystemService(StorageManager.class).openProxyFileDescriptor(
          ParcelFileDescriptor.MODE_WRITE_ONLY, new ProxyFileDescriptorCallback() {
            @Override public long onGetSize() { return state.bytes; }
            @Override public int onWrite(long offset, int size, byte[] data) throws ErrnoException {
              int available = (int) Math.max(0, QUOTA_BYTES - offset);
              if (available == 0) {
                state.writeErrors++;
                throw new ErrnoException("proof-provider-write", "enospc".equals(mode) ? OsConstants.ENOSPC : OsConstants.EIO);
              }
              int accepted = Math.min(available, size);
              state.bytes = Math.max(state.bytes, offset + accepted);
              return accepted;
            }
            @Override public void onFsync() { }
            @Override public void onRelease() { state.released = true; state.thread.quitSafely(); }
          }, new Handler(state.thread.getLooper()));
    } catch (IOException error) {
      transfers.remove(token);
      state.dispose();
      throw new FileNotFoundException(error.toString());
    }
  }

  @Override public Bundle call(String method, String token, Bundle extras) {
    requireProofCaller();
    Transfer state = transfers.get(token);
    if (state == null) throw new IllegalArgumentException("Unknown proof token");
    if ("await-close-error".equals(method)) {
      try {
        if (!state.remoteError.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Provider close error timed out");
      } catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IllegalStateException(error); }
    } else if (!"stats".equals(method)) throw new IllegalArgumentException("Unknown proof operation");
    Bundle result = new Bundle();
    result.putLong("bytes", state.bytes);
    result.putInt("writeErrors", state.writeErrors);
    result.putBoolean("released", state.released);
    result.putBoolean("remoteError", state.closeErrorReported);
    result.putString("workerError", state.workerError);
    return result;
  }

  @Override public int delete(Uri uri, String selection, String[] args) {
    Transfer state = transfers.remove(token(uri));
    if (state == null) return 0;
    state.dispose();
    return 1;
  }
  @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) { token(uri); return null; }
  @Override public Uri insert(Uri uri, ContentValues values) { token(uri); throw new UnsupportedOperationException(); }
  @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { token(uri); throw new UnsupportedOperationException(); }
}
