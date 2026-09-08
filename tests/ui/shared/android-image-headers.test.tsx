import { expect, it, jest } from '@jest/globals';
import { render, renderHook } from '@testing-library/react-native';
import React from 'react';
import type { ImageProps, ImageURISource } from 'react-native';
import { useImageLoadDiagnostics } from '@/platform/media/imageLoadDiagnostics';

jest.mock('react-native/Libraries/Image/ImageViewNativeComponent', () => 'RCTImageView');

const AndroidImage = jest.requireActual<{ default: React.ComponentType<ImageProps> }>(
  'react-native/Libraries/Image/Image.android'
).default;

it('forwards scalar image credentials and diagnostic markers to the native request', async () => {
  const headers = { Cookie: 'test-only', 'X-WZ-Image-Trace': 'trace-123' };
  const source = { uri: 'https://example.com/image.png', headers };
  const screen = await render(<AndroidImage source={source} testID="native-image" />);
  expect(screen.getByTestId('native-image').props.headers).toEqual(headers);
  expect(screen.getByTestId('native-image').props.source).toEqual([source]);
});

it.each(['fresco', 'glide'] as const)(
  'keeps %s diagnostics stable for equal request values and renews them for real changes',
  async (consumer) => {
    const source = {
      uri: 'https://example.com/image.png',
      cacheKey: 'account:1:image',
      width: 320,
      headers: { Referer: 'https://example.com/', Accept: 'image/*' }
    };
    const hook = await renderHook(
      ({ image, attempt }: { image: ImageURISource & { cacheKey?: string }; attempt: number }) =>
        useImageLoadDiagnostics(image, attempt, consumer),
      { initialProps: { image: source, attempt: 1 } }
    );
    const first = hook.result.current;
    first.displayed();
    await hook.rerender({
      image: {
        headers: { Accept: 'image/*', Referer: 'https://example.com/' },
        width: 320,
        cacheKey: source.cacheKey,
        uri: source.uri
      },
      attempt: 1
    });
    expect(hook.result.current).toBe(first);

    for (const props of [
      { image: source, attempt: 2 },
      { image: { ...source, headers: { ...source.headers, Referer: 'https://example.com/other' } }, attempt: 1 },
      { image: { ...source, cacheKey: 'account:2:image' }, attempt: 1 },
      { image: { ...source, width: 640 }, attempt: 1 },
      { image: { ...source, uri: 'file:///cache/poster.png' }, attempt: 1 }
    ]) {
      await hook.rerender({ image: source, attempt: 1 });
      const previous = hook.result.current;
      await hook.rerender(props);
      expect(hook.result.current).not.toBe(previous);
      expect(hook.result.current.source).toMatchObject(props.image);
      if (hook.result.current.source.uri?.startsWith('https:')) {
        expect(hook.result.current.source.headers?.['X-WZ-Image-Trace']).not.toBe(
          previous.source.headers?.['X-WZ-Image-Trace']
        );
      }
    }
  }
);
