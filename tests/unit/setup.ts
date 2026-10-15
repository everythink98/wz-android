import { vi } from 'vitest';

// Unit tests supply the installed Android provider; platform tests import the actual .android owner.
vi.mock('@/platform/android/androidWebViewUserAgent', () => ({
  getDefaultAndroidWebViewUserAgent: vi.fn(async () => 'native-provider-user-agent')
}));
