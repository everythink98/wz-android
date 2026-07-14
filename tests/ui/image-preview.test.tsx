import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { Image as RNImage } from 'react-native';
import { ImagePreviewModal } from '../../src/components/ImagePreviewModal';
import { createEmptyReaderData } from '../../src/readerData';
import { createStyles, createTheme } from '../../src/theme';

jest.mock('expo-image', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    Image: ({ contentFit, ...props }: { contentFit?: string }) => ReactModule.createElement(
      NativeView,
      { ...props, testID: contentFit === 'contain' ? 'active-preview-image' : undefined }
    )
  };
});

jest.mock('react-native-gesture-handler', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    GestureHandlerRootView: ({ children, ...props }: { children?: React.ReactNode }) => ReactModule.createElement(
      NativeView,
      props,
      children
    )
  };
});

jest.mock('react-native-zoom-toolkit', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    fitContainer: (_ratio: number, size: { width: number; height: number }) => size,
    ResumableZoom: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement(NativeView, null, children)
  };
});

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { ChevronLeft: Icon, ChevronRight: Icon, X: Icon };
});

const readerData = createEmptyReaderData();
const theme = createTheme(readerData.settings);
const styles = createStyles(theme, readerData.settings, 800);

describe('Image preview', () => {
  beforeEach(() => {
    jest.spyOn(RNImage, 'getSize').mockImplementation(((...args: unknown[]) => {
      const success = args[1];
      if (typeof success === 'function') {
        success(1200, 800);
      }
    }) as typeof RNImage.getSize);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('navigates a multi-image preview and exposes save, select and close actions', async () => {
    const onClose = jest.fn<() => void>();
    const onNext = jest.fn<() => void>();
    const onPrevious = jest.fn<() => void>();
    const onSave = jest.fn<() => void>();
    const onSelect = jest.fn<(index: number) => void>();
    const view = await render(
      <ImagePreviewModal
        preview={{
          urls: [
            'https://example.com/one.png',
            'https://example.com/two.png',
            'https://example.com/three.png'
          ],
          index: 1
        }}
        styles={styles}
        theme={theme}
        onClose={onClose}
        onNext={onNext}
        onPrevious={onPrevious}
        onSave={onSave}
        onSelect={onSelect}
      />
    );

    expect(view.getByText('2 / 3')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('上一张图片'));
    await fireEvent.press(view.getByLabelText('下一张图片'));
    await fireEvent.press(view.getByLabelText('查看第 3 张图片'));
    await fireEvent.press(view.getByLabelText('保存图片'));
    await fireEvent.press(view.getByLabelText('关闭图片预览'));

    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(2);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('replaces the loading state with a visible failure message when the image cannot load', async () => {
    const view = await render(
      <ImagePreviewModal
        preview={{ urls: ['https://example.com/broken.png'], index: 0 }}
        styles={styles}
        theme={theme}
        onClose={jest.fn()}
        onNext={jest.fn()}
        onPrevious={jest.fn()}
        onSave={jest.fn()}
        onSelect={jest.fn()}
      />
    );

    expect(view.getByText('图片加载中...')).toBeTruthy();
    await fireEvent(view.getByTestId('active-preview-image'), 'error');
    expect(view.queryByText('图片加载中...')).toBeNull();
    expect(view.getByText('图片加载失败')).toBeTruthy();
  });
});
