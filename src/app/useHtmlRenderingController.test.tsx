import { describe, expect, it, vi } from 'vitest';

const getManagedCookieHeaderForUrl = vi.hoisted(() => vi.fn());
const networkProxyModule = vi.hoisted(() => ({
  getManagedCookieHeaderForUrl
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  NativeModules: {
    NetworkProxyModule: networkProxyModule
  },
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
  isManagedVideoCookieReady,
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

  it('[REG-ACCOUNT-029] reads the live Cookie header for the exact video URL before playback', async () => {
    getManagedCookieHeaderForUrl.mockResolvedValueOnce('future_cookie=future');

    await expect(readManagedWebViewCookieHeader(
      'https://www.nodeseek.com/uploads/private/video.webm?version=2'
    )).resolves.toBe('future_cookie=future');
    expect(getManagedCookieHeaderForUrl).toHaveBeenCalledWith(
      'https://www.nodeseek.com/uploads/private/video.webm?version=2'
    );
  });

  it('[REG-ACCOUNT-029] does not treat a failed managed Cookie read as an anonymous-ready video', () => {
    expect(isManagedVideoCookieReady({
      url: 'https://www.nodeseek.com/uploads/private/video.webm',
      status: 'failed'
    }, 'https://www.nodeseek.com/uploads/private/video.webm')).toBe(false);
  });

  it('[REG-ACCOUNT-029] fails closed when the managed Cookie reader is unavailable', async () => {
    const reader = networkProxyModule.getManagedCookieHeaderForUrl;
    networkProxyModule.getManagedCookieHeaderForUrl = undefined as never;
    try {
      await expect(readManagedWebViewCookieHeader(
        'https://www.nodeseek.com/uploads/private/video.webm'
      )).rejects.toThrow('原生 Cookie 读取能力不可用');
    } finally {
      networkProxyModule.getManagedCookieHeaderForUrl = reader;
    }
  });
});
