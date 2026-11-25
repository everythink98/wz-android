package com.reactnativecommunity.slider;

import android.app.Activity;
import android.view.MotionEvent;
import android.widget.FrameLayout;
import com.facebook.react.bridge.BridgeReactContext;
import com.facebook.react.touch.JSResponderHandler;
import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.events.BatchEventDispatchedListener;
import com.facebook.react.uimanager.events.Event;
import com.facebook.react.uimanager.events.EventDispatcher;
import com.facebook.react.uimanager.events.EventDispatcherListener;
import com.facebook.react.uimanager.events.EventDispatcherProvider;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BiConsumer;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.android.controller.ActivityController;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
public class ReaderSliderGestureTest {
    @Test
    public void touchCancellationDispatchesNoCompletionButReleaseDispatchesOne() {
        withSlider((slider, completed) -> {
            touch(slider, MotionEvent.ACTION_DOWN, 0L, 30f);
            touch(slider, MotionEvent.ACTION_MOVE, 16L, 140f);
            touch(slider, MotionEvent.ACTION_CANCEL, 32L, 140f);
            assertTrue(completed.isEmpty());
            assertFalse(slider.isSliding());

            touch(slider, MotionEvent.ACTION_DOWN, 48L, 90f);
            touch(slider, MotionEvent.ACTION_MOVE, 64L, 160f);
            touch(slider, MotionEvent.ACTION_UP, 80L, 160f);
            assertCompletion(slider, completed);
        });
    }

    @Test
    public void disablingAnActiveSliderCancelsTheDragAndAcceptsPlaybackProgressAgain() {
        withSlider((slider, completed) -> {
            touch(slider, MotionEvent.ACTION_DOWN, 0L, 30f);
            touch(slider, MotionEvent.ACTION_MOVE, 16L, 140f);
            assertTrue(slider.isSliding());

            ReactSliderManagerImpl.setDisabled(slider, true);
            touch(slider, MotionEvent.ACTION_CANCEL, 32L, 140f);
            assertFalse(slider.isSliding());
            assertTrue(completed.isEmpty());

            ReactSliderManagerImpl.setValue(slider, 0.25);
            assertEquals(0.25, slider.toRealProgress(slider.getProgress()), 0.001);

            ReactSliderManagerImpl.setDisabled(slider, false);
            touch(slider, MotionEvent.ACTION_DOWN, 48L, 90f);
            touch(slider, MotionEvent.ACTION_MOVE, 64L, 160f);
            touch(slider, MotionEvent.ACTION_UP, 80L, 160f);
            assertCompletion(slider, completed);
        });
    }

    private static void assertCompletion(ReactSlider slider, List<ReactSlidingCompleteEvent> completed) {
        assertEquals(1, completed.size());
        ReactSlidingCompleteEvent event = completed.get(0);
        assertEquals(slider.getId(), event.getViewTag());
        assertEquals(slider.toRealProgress(slider.getProgress()), event.getValue(), 0.001);
    }

    private static void withSlider(BiConsumer<ReactSlider, List<ReactSlidingCompleteEvent>> run) {
        try (ActivityController<Activity> controller = Robolectric.buildActivity(Activity.class).setup()) {
            Activity activity = controller.get();
            RecordingDispatcher dispatcher = new RecordingDispatcher();
            ThemedReactContext context = new ThemedReactContext(
                new DispatchingReactContext(activity, dispatcher), activity, "ReaderSliderGestureTest", 1
            );
            ReactSliderManager manager = new ReactSliderManager();
            ReactSlider slider = manager.createView(13, context, null, null, new JSResponderHandler());
            manager.setMaximumValue(slider, 1.0);
            FrameLayout parent = new FrameLayout(activity);
            parent.addView(slider);
            activity.setContentView(parent);
            slider.layout(0, 0, 320, 72);
            run.accept(slider, dispatcher.completed);
        }
    }

    private static void touch(ReactSlider slider, int action, long time, float x) {
        MotionEvent event = MotionEvent.obtain(0L, time, action, x, 36f, 0);
        try {
            slider.onTouchEvent(event);
        } finally {
            event.recycle();
        }
    }

    @SuppressWarnings("deprecation")
    private static final class DispatchingReactContext extends BridgeReactContext
        implements EventDispatcherProvider {
        private final EventDispatcher dispatcher;

        DispatchingReactContext(Activity activity, EventDispatcher dispatcher) {
            super(activity);
            this.dispatcher = dispatcher;
        }

        @Override
        public EventDispatcher getEventDispatcher() {
            return dispatcher;
        }
    }

    private static final class RecordingDispatcher implements EventDispatcher {
        final List<ReactSlidingCompleteEvent> completed = new ArrayList<>();

        @Override
        public void dispatchEvent(Event<?> event) {
            if (event instanceof ReactSlidingCompleteEvent completion) completed.add(completion);
        }

        @Override public void dispatchAllEvents() {}
        @Override public void addListener(EventDispatcherListener listener) {}
        @Override public void removeListener(EventDispatcherListener listener) {}
        @Override public void addBatchEventDispatchedListener(BatchEventDispatchedListener listener) {}
        @Override public void removeBatchEventDispatchedListener(BatchEventDispatchedListener listener) {}
        @Override @SuppressWarnings("deprecation") public void onCatalystInstanceDestroyed() {}
    }
}
