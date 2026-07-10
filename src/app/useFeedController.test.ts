import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-cookies/cookies', () => ({
  default: {
    flush: vi.fn(async () => undefined),
    get: vi.fn(async () => ({})),
    clearByName: vi.fn(async () => true)
  }
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

vi.mock('react-native', () => ({
  NativeModules: {
    LinuxDoCookieModule: {}
  }
}));

import { mergedFeedResponseAfterSplitFetch, shouldWaitForReaderDataBeforeFeed } from './useFeedController';
import type { FeedResponse } from '../types';

describe('feed controller helpers', () => {
  const response: FeedResponse = {
    items: [],
    errors: {},
    hasMore: true,
    nextPage: 3
  };

  it('does not apply partial all-feed load-more results when any source failed', () => {
    expect(mergedFeedResponseAfterSplitFetch([response], { yaohuo: { kind: 'ordinary', message: 'HTTP 500' } }, true)).toBeNull();
  });

  it('keeps partial all-feed refresh results when a source failed', () => {
    expect(mergedFeedResponseAfterSplitFetch([response], { yaohuo: { kind: 'ordinary', message: 'HTTP 500' } }, false)).toEqual(response);
  });

  it('lets the default all feed load before reader data finishes loading', () => {
    expect(shouldWaitForReaderDataBeforeFeed('all', 'all')).toBe(false);
    expect(shouldWaitForReaderDataBeforeFeed('all', 'favorite')).toBe(true);
  });
});
