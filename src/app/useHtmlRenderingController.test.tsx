import { describe, expect, it, vi } from 'vitest';

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

import { shouldShowVideoStickerLoading } from './useHtmlRenderingController';

describe('HTML topic media loading state', () => {
  it('keeps video sticker loading visible until the first rendered frame', () => {
    expect(shouldShowVideoStickerLoading(false, false, 'idle')).toBe(true);
    expect(shouldShowVideoStickerLoading(false, false, 'readyToPlay')).toBe(true);
    expect(shouldShowVideoStickerLoading(true, false, 'readyToPlay')).toBe(false);
    expect(shouldShowVideoStickerLoading(false, true, 'error')).toBe(false);
  });
});
