import { describe, expect, it, vi } from 'vitest';

const readManagedCookieHeader = vi.hoisted(() => vi.fn());

vi.mock('../managedCookies', () => ({
  readManagedCookieHeader
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  PixelRatio: { get: () => 1 },
  Pressable: 'Pressable',
  StyleSheet: {
    absoluteFillObject: {},
    create: (styles: unknown) => styles,
    flatten: (style: unknown) => Array.isArray(style) ? Object.assign({}, ...style) : style,
    hairlineWidth: 1
  },
  Text: 'Text',
  View: 'View'
}));

vi.mock('react-native-webview', () => ({
  WebView: 'WebView'
}));

vi.mock('expo-image', () => ({
  Image: 'ExpoImage',
  useImage: vi.fn()
}));

vi.mock('expo', () => ({
  useEvent: vi.fn((_player, _eventName, initialValue) => initialValue)
}));

vi.mock('expo-video', () => ({
  VideoView: 'VideoView',
  useVideoPlayer: vi.fn(() => ({
    pause: vi.fn(),
    play: vi.fn(),
    playing: false
  }))
}));

vi.mock('lucide-react-native', () => ({
  Maximize2: 'Maximize2',
  Play: 'Play'
}));

vi.mock('react-native-render-html', () => ({
  getNativePropsForTNode: vi.fn(() => ({})),
  useIMGElementProps: vi.fn(),
  useIMGElementStateWithCache: vi.fn()
}));

import {
  readManagedWebViewCookieHeader,
  shouldShowVideoStickerLoading
} from './useHtmlRenderingController';

describe('HTML topic media loading state', () => {
  it('keeps video sticker loading visible until the first rendered frame', () => {
    expect(shouldShowVideoStickerLoading(false, false, 'idle')).toBe(true);
    expect(shouldShowVideoStickerLoading(false, false, 'readyToPlay')).toBe(true);
    expect(shouldShowVideoStickerLoading(true, false, 'readyToPlay')).toBe(false);
    expect(shouldShowVideoStickerLoading(false, true, 'error')).toBe(false);
  });

  it('reads the live Cookie header for the exact managed WebView URL', async () => {
    readManagedCookieHeader.mockResolvedValueOnce({
      status: 'ok',
      header: 'future_cookie=future'
    });

    await expect(readManagedWebViewCookieHeader(
      'https://www.nodeseek.com/uploads/private/video.webm?version=2'
    )).resolves.toBe('future_cookie=future');
    expect(readManagedCookieHeader).toHaveBeenCalledWith(
      'https://www.nodeseek.com/uploads/private/video.webm?version=2'
    );
  });

  it('[REG-ACCOUNT-029] fails closed when the managed Cookie reader is unavailable', async () => {
    readManagedCookieHeader.mockResolvedValueOnce({ status: 'unsupported' });
    await expect(readManagedWebViewCookieHeader(
      'https://www.nodeseek.com/uploads/private/video.webm'
    )).rejects.toThrow('原生 Cookie 读取能力不可用');
  });
});
