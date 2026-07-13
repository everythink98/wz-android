import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
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
  Image: 'ExpoImage'
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
  HTMLContentModel: { block: 'block', mixed: 'mixed', textual: 'textual' },
  HTMLElementModel: { fromCustomModel: vi.fn((model) => model) },
  RenderHTMLConfigProvider: 'RenderHTMLConfigProvider',
  TChildrenRenderer: 'TChildrenRenderer',
  TRenderEngineProvider: 'TRenderEngineProvider',
  defaultHTMLElementModels: {
    details: { extend: vi.fn((model) => model) },
    summary: { extend: vi.fn((model) => model) }
  },
  getNativePropsForTNode: vi.fn(() => ({})),
  useContentWidth: vi.fn(),
  useIMGElementProps: vi.fn(),
  useIMGElementState: vi.fn(),
  useTNodeChildrenProps: vi.fn()
}));

vi.mock('../forumMediaPlayback', () => ({ useForumMediaPlaybackActive: () => true }));

import { shouldShowPreviewImageLoading, shouldShowVideoStickerLoading } from './useHtmlRenderingController';

describe('HTML topic image loading state', () => {
  it('keeps loading visible after dimensions are ready until the native image finishes loading', () => {
    expect(shouldShowPreviewImageLoading('success', false)).toBe(true);
    expect(shouldShowPreviewImageLoading('success', true)).toBe(false);
  });

  it('shows loading while dimensions are unresolved but not after an image error', () => {
    expect(shouldShowPreviewImageLoading('loading', false)).toBe(true);
    expect(shouldShowPreviewImageLoading('error', false)).toBe(false);
  });

  it('keeps video sticker loading visible until the first rendered frame', () => {
    expect(shouldShowVideoStickerLoading(false, false, 'idle')).toBe(true);
    expect(shouldShowVideoStickerLoading(false, false, 'readyToPlay')).toBe(true);
    expect(shouldShowVideoStickerLoading(true, false, 'readyToPlay')).toBe(false);
    expect(shouldShowVideoStickerLoading(false, true, 'error')).toBe(false);
  });
});
