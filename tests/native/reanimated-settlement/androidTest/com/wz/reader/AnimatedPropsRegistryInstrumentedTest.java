package com.wz.reader;
@org.junit.runner.RunWith(androidx.test.ext.junit.runners.AndroidJUnit4.class)
public final class AnimatedPropsRegistryInstrumentedTest {
  @org.junit.Test public void actualRegistrySettlesEvictsAndRefreshesInvalidatedProps() {
    org.junit.Assert.assertEquals("REGISTRY_SETTLEMENT_NATIVE_PASS", RegistrySettlementProof.run());
  }
}
