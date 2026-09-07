import android.os.SystemClock;
import android.view.InputEvent;
import android.view.InputDevice;
import android.view.MotionEvent;
import java.lang.reflect.Method;

// Runs as adb shell, without installing an instrumentation APK or changing App data.
public class TouchTrace {
  public static void main(String[] args) throws Exception {
    Class<?> cls = Class.forName("android.hardware.input.InputManagerGlobal");
    Object manager = cls.getMethod("getInstance").invoke(null);
    Method inject = cls.getMethod("injectInputEvent", InputEvent.class, int.class);
    long start = SystemClock.uptimeMillis(), down = start;
    StringBuilder delivered = new StringBuilder();
    for (String point : args[0].split(";")) {
      String[] p = point.split(",");
      long time = start + Long.parseLong(p[0]);
      SystemClock.sleep(Math.max(0, time - SystemClock.uptimeMillis()));
      int action = Integer.parseInt(p[1]);
      if (action == MotionEvent.ACTION_DOWN) down = SystemClock.uptimeMillis();
      MotionEvent event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action,
          Float.parseFloat(p[2]), Float.parseFloat(p[3]), 0);
      event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
      delivered.append(event.getEventTime() - start).append(',').append(action).append(';');
      try {
        if (!(Boolean) inject.invoke(manager, event, 2)) throw new AssertionError("Injection failed");
      } finally {
        event.recycle();
      }
    }
    System.out.println(delivered);
  }
}
