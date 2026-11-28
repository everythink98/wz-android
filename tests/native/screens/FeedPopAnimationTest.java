package com.swmansion.rnscreens;

import android.app.Application;
import android.content.Context;
import android.graphics.Matrix;
import android.view.View;
import android.view.animation.Animation;
import android.view.animation.AnimationUtils;
import android.view.animation.Transformation;
import android.widget.FrameLayout;
import android.widget.ScrollView;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, application = Application.class)
public class FeedPopAnimationTest {
  private final Context context = RuntimeEnvironment.getApplication();
  private final int enter = R.anim.rns_slide_in_from_left;
  private final int exit = R.anim.rns_slide_out_to_right;

  private FrameLayout tabs(boolean feedVisible) {
    FrameLayout tabs = new FrameLayout(context);
    FrameLayout retained = new FrameLayout(context);
    ScrollView feed = new ScrollView(context);
    feed.setTag(com.facebook.react.R.id.view_tag_native_id, "wz-retained-feed-scroll");
    retained.addView(feed);
    retained.setVisibility(feedVisible ? View.VISIBLE : View.INVISIBLE);
    tabs.addView(retained);
    return tabs;
  }

  private FeedPopAnimation select(boolean standard, String from, String to, View root) {
    return FeedPopAnimation.select(standard, from, to, root, 1080);
  }

  private Animation load(FeedPopAnimation selection, boolean entering, int id) {
    if (selection != null) {
      Animation chosen = selection.load(context, entering, id);
      if (chosen != null) return chosen;
    }
    return AnimationUtils.loadAnimation(context, id);
  }

  private float x(Animation animation, long time) {
    Transformation out = new Transformation();
    animation.getTransformation(time, out);
    float[] values = new float[9];
    out.getMatrix().getValues(values);
    return values[Matrix.MTRANS_X];
  }

  private void reset(int width, Animation... animations) {
    for (Animation a : animations) {
      a.initialize(width, 1920, width, 1920);
      a.setStartTime(1000);
    }
  }

  @Test public void actualFrameworkResourcesKeepTimingAndBothSidesAlign() {
    FeedPopAnimation pair = select(true, "Topic-id", "MainTabs-id", tabs(true));
    Animation raw = AnimationUtils.loadAnimation(context, exit);
    Animation in = load(pair, true, enter);
    Animation out = load(pair, false, exit);
    reset(1080, raw, in, out);
    assertTrue(raw.getDuration() > 16);
    assertEquals(raw.getDuration(), in.getDuration());
    assertEquals(raw.getDuration(), out.getDuration());
    boolean fractional = false;
    for (long elapsed = 0; elapsed <= raw.getDuration(); elapsed++) {
      float before = x(raw, 1000 + elapsed);
      fractional |= Math.abs(before - Math.round(before)) > 0.005f;
      float current = x(out, 1000 + elapsed);
      assertEquals("standard XML translation aligns to a physical pixel", (float)Math.round(current), current, 0f);
      assertEquals(before, current, 0.50001f);
      assertEquals("one viewport between screen origins", 1080f, current - x(in, 1000 + elapsed), 0f);
    }
    assertTrue("control XML produces fractional physical pixels during motion", fractional);
    assertEquals(1080f, x(out, 1000 + out.getDuration()), 0f);
  }

  @Test public void otherRoutesAndInactiveFeedUseTheirOriginalAnimations() {
    assertNull(select(false, "Topic-id", "MainTabs-id", tabs(true)));
    assertNull(select(true, "TopicComposer-id", "MainTabs-id", tabs(true)));
    assertNull(select(true, "Topic-id", "Topic-id2", tabs(true)));
    assertNull(select(true, "Topic-id", "MainTabs-id", tabs(false)));
    assertNull(select(true, "Topic-id", "MainTabs-id", new FrameLayout(context)));
    FrameLayout detachedTabs = tabs(true);
    detachedTabs.setVisibility(View.INVISIBLE);
    assertNotNull(select(true, "Topic-id", "MainTabs-id", detachedTabs));
  }

  @Test public void changedAnimationResourceReturnsBothSidesToFragmentManager() {
    FeedPopAnimation pair = select(true, "Topic-id", "MainTabs-id", tabs(true));
    assertNull(pair.load(context, true, exit));
    assertNull(pair.load(context, false, exit));
  }

  @Test public void unexpectedWidthUsesOriginalFractionalTranslation() {
    FeedPopAnimation pair = select(true, "Topic-id", "MainTabs-id", tabs(true));
    Animation raw = AnimationUtils.loadAnimation(context, exit);
    Animation candidate = load(pair, false, exit);
    reset(997, raw, candidate);
    for (long t = 1000; t <= 1000 + raw.getDuration(); t += 7) {
      assertEquals(x(raw, t), x(candidate, t), 0f);
    }
  }
}
