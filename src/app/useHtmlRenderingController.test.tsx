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

vi.mock('react-native-render-html', () => ({
  getNativePropsForTNode: vi.fn(() => ({})),
  useIMGElementProps: vi.fn(),
  useIMGElementState: vi.fn()
}));

import { shouldShowPreviewImageLoading } from './useHtmlRenderingController';

describe('HTML topic image loading state', () => {
  it('keeps loading visible after dimensions are ready until the native image finishes loading', () => {
    expect(shouldShowPreviewImageLoading('success', false)).toBe(true);
    expect(shouldShowPreviewImageLoading('success', true)).toBe(false);
  });

  it('shows loading while dimensions are unresolved but not after an image error', () => {
    expect(shouldShowPreviewImageLoading('loading', false)).toBe(true);
    expect(shouldShowPreviewImageLoading('error', false)).toBe(false);
  });
});
