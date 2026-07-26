import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { ImagePreviewModal } from '../../src/components/ImagePreviewModal';
import { createEmptyReaderData } from '../../src/readerData';
import { createStyles, createTheme } from '../../src/theme';
import { ForumSessionEpochProvider } from '../../src/mediaSessionEpoch';
import { initialForumSessionEpochs } from '../../src/app/serverState';
import { setDiagnosticWriter } from '../../src/diagnostics';

jest.mock('expo-image', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    Image: ({ contentFit, ...props }: {
      contentFit?: string;
      onError?: () => void;
      onLoad?: (event: { source: { height: number; width: number } }) => void;
      source?: { uri?: string };
    }) => {
      ReactModule.useLayoutEffect(() => {
        if (props.source?.uri?.includes('fast-cache')) {
          props.onLoad?.({ source: { height: 480, width: 640 } });
        } else if (props.source?.uri?.includes('fast-error')) {
          props.onError?.();
        }
      }, [props.source?.uri]);
      return ReactModule.createElement(
        NativeView,
        { ...props, testID: contentFit === 'contain' ? 'active-preview-image' : 'preview-thumbnail-image' }
      );
    }
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
  it('REG-TOPIC-031 settles an immediate cache hit instead of restoring the spinner', async () => {
    const view = await render(
      <ImagePreviewModal
        preview={{ contentSource: null, urls: ['https://example.com/fast-cache.png'], index: 0 }}
        styles={styles}
        theme={theme}
        onClose={jest.fn()}
        onNext={jest.fn()}
        onPrevious={jest.fn()}
        onSave={jest.fn()}
        onSelect={jest.fn()}
      />
    );

    expect(view.queryByText('图片加载中...')).toBeNull();
    expect(view.queryByText('图片加载失败')).toBeNull();
  });

  it('REG-TOPIC-031 settles an immediate native failure instead of restoring the spinner', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    try {
      const view = await render(
        <ImagePreviewModal
          preview={{ contentSource: null, urls: ['https://example.com/fast-error.png'], index: 0 }}
          styles={styles}
          theme={theme}
          onClose={jest.fn()}
          onNext={jest.fn()}
          onPrevious={jest.fn()}
          onSave={jest.fn()}
          onSelect={jest.fn()}
        />
      );

      await waitFor(() => expect(view.getByText('图片加载失败')).toBeTruthy());
      expect(view.queryByText('图片加载中...')).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('REG-TOPIC-031 keeps the active request mounted through StrictMode effect replay', async () => {
    const view = await render(
      <React.StrictMode>
        <ImagePreviewModal
          preview={{ contentSource: null, urls: ['https://example.com/strict.png'], index: 0 }}
          styles={styles}
          theme={theme}
          onClose={jest.fn()}
          onNext={jest.fn()}
          onPrevious={jest.fn()}
          onSave={jest.fn()}
          onSelect={jest.fn()}
        />
      </React.StrictMode>
    );

    await fireEvent(view.getByTestId('active-preview-image'), 'load', {
      source: { height: 480, width: 640 }
    });

    expect(view.queryByText('图片加载中...')).toBeNull();
    expect(view.queryByText('图片加载失败')).toBeNull();
  });

  it('[REG-TOPIC-031] starts a fresh settlement when navigation returns to an earlier identity', async () => {
    const callbacks = {
      onClose: jest.fn(),
      onNext: jest.fn(),
      onPrevious: jest.fn(),
      onSave: jest.fn(),
      onSelect: jest.fn()
    };
    const modal = (index: number) => (
      <ImagePreviewModal
        preview={{
          contentSource: null,
          urls: ['https://example.com/a.png', 'https://example.com/b.png'],
          index
        }}
        styles={styles}
        theme={theme}
        {...callbacks}
      />
    );
    const view = await render(modal(0));

    await fireEvent(view.getByTestId('active-preview-image'), 'load', {
      source: { height: 480, width: 640 }
    });
    await view.rerender(modal(1));
    await fireEvent(view.getByTestId('active-preview-image'), 'loadStart');
    await view.rerender(modal(0));

    expect(view.getByText('图片加载中...')).toBeTruthy();

    await fireEvent(view.getByTestId('active-preview-image'), 'load', {
      source: { height: 480, width: 640 }
    });

    expect(view.queryByText('图片加载中...')).toBeNull();
    expect(view.queryByText('图片加载失败')).toBeNull();
  });

  it('[REG-TOPIC-031] ignores a late native event from the previous identity', async () => {
    const callbacks = {
      onClose: jest.fn(),
      onNext: jest.fn(),
      onPrevious: jest.fn(),
      onSave: jest.fn(),
      onSelect: jest.fn()
    };
    const modal = (index: number) => (
      <ImagePreviewModal
        preview={{
          contentSource: null,
          urls: ['https://example.com/a.png', 'https://example.com/b.png'],
          index
        }}
        styles={styles}
        theme={theme}
        {...callbacks}
      />
    );
    const view = await render(modal(0));
    const staleImage = view.getByTestId('active-preview-image');
    const staleEvents = {
      onError: staleImage.props.onError as () => void,
      onLoad: staleImage.props.onLoad as (event: { source: { height: number; width: number } }) => void,
      onLoadStart: staleImage.props.onLoadStart as () => void
    };
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('stale request must not recover'));

    try {
      await view.rerender(modal(1));
      expect(view.getByText('图片加载中...')).toBeTruthy();

      await act(async () => staleEvents.onError());
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(view.getByText('图片加载中...')).toBeTruthy();

      await act(async () => staleEvents.onLoadStart());
      expect(view.getByText('图片加载中...')).toBeTruthy();

      await act(async () => staleEvents.onLoad({ source: { height: 480, width: 640 } }));
      expect(view.getByText('图片加载中...')).toBeTruthy();

      await fireEvent(view.getByTestId('active-preview-image'), 'load', {
        source: { height: 480, width: 640 }
      });

      expect(view.queryByText('图片加载中...')).toBeNull();
      expect(view.queryByText('图片加载失败')).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
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
          contentSource: null,
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
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      headers: { get: () => 'image/png' },
      ok: true
    } as unknown as Response);
    try {
      const view = await render(
        <ImagePreviewModal
          preview={{ contentSource: null, urls: ['https://example.com/broken.png'], index: 0 }}
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
      await waitFor(() => expect(view.getByText('图片加载失败')).toBeTruthy());
      expect(view.queryByText('图片加载中...')).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('[REG-TOPIC-032] settles a stalled preview within the 30 second image budget', async () => {
    const diagnosticLines: string[] = [];
    setDiagnosticWriter((line) => {
      diagnosticLines.push(line);
    });
    jest.useFakeTimers();
    try {
      const view = await render(
        <ImagePreviewModal
          preview={{ contentSource: null, urls: ['https://example.com/stalled.png'], index: 0 }}
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
      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });
      expect(view.getByText('图片加载失败')).toBeTruthy();
      expect(view.queryByText('图片加载中...')).toBeNull();
      await fireEvent(view.getByTestId('active-preview-image'), 'load', {
        source: { height: 480, width: 640 }
      });
      expect(view.getByText('图片加载失败')).toBeTruthy();
      const diagnosticEvents = diagnosticLines.map((line) => JSON.parse(line));
      expect(diagnosticEvents).toContainEqual(expect.objectContaining({
        area: 'media',
        phase: 'intent',
        surface: 'preview'
      }));
      expect(diagnosticEvents).toContainEqual(expect.objectContaining({
        area: 'media',
        outcome: 'failure',
        terminalReason: 'timeout'
      }));
    } finally {
      setDiagnosticWriter(null);
      jest.useRealTimers();
    }
  });

  it('REG-TOPIC-018 retries an Android-incompatible remote SVG with the compatible source', async () => {
    const imageUrl = 'https://example.com/dynamic-preview.png';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      headers: {
        get: (name: string) => name.toLowerCase() === 'content-type' ? 'image/svg+xml' : null
      },
      ok: true,
      text: async () => '<svg xmlns="http://www.w3.org/2000/svg"><text><a href="https://example.com"><tspan>report</tspan></a></text></svg>'
    } as Response);
    try {
      const view = await render(
        <ImagePreviewModal
          preview={{ contentSource: null, urls: [imageUrl], index: 0 }}
          styles={styles}
          theme={theme}
          onClose={jest.fn()}
          onNext={jest.fn()}
          onPrevious={jest.fn()}
          onSave={jest.fn()}
          onSelect={jest.fn()}
        />
      );

      await fireEvent(view.getByTestId('active-preview-image'), 'error');

      await waitFor(() => expect(view.getByTestId('active-preview-image').props.source).toEqual(
        expect.objectContaining({ uri: expect.stringMatching(/^data:image\/svg\+xml;base64,/) })
      ));
      expect(view.queryByText('图片加载失败')).toBeNull();
      expect(view.getByText('图片加载中...')).toBeTruthy();
      await fireEvent(view.getByTestId('active-preview-image'), 'load', {
        source: { height: 1025, width: 920 }
      });
      expect(view.queryByText('图片加载中...')).toBeNull();
      expect(view.queryByText('图片加载失败')).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('REG-TOPIC-019 keeps NodeSeek media credentials in the full-screen preview request', async () => {
    const imageUrl = 'https://www.nodeseek.com/uploads/private-topic.png';
    const view = await render(
      <ForumSessionEpochProvider sessionEpochs={{ ...initialForumSessionEpochs, nodeseek: 4 }}>
        <ImagePreviewModal
          preview={{ contentSource: 'nodeseek', urls: [imageUrl], index: 0 }}
          nodeSeekMediaUserAgent="WZ-Preview-Test"
          styles={styles}
          theme={theme}
          onClose={jest.fn()}
          onNext={jest.fn()}
          onPrevious={jest.fn()}
          onSave={jest.fn()}
          onSelect={jest.fn()}
        />
      </ForumSessionEpochProvider>
    );

    expect(view.getByTestId('active-preview-image').props.source).toEqual(expect.objectContaining({
      cacheKey: `nodeseek:4:${imageUrl}`,
      headers: expect.objectContaining({
        'User-Agent': 'WZ-Preview-Test',
        'X-WZ-Forum-Media-Source': 'nodeseek'
      })
    }));
    expect(view.getByTestId('active-preview-image').props.source.headers).not.toHaveProperty('Cookie');
  });

  it('[REG-ACCOUNT-029] changes the same preview source and recycling key when the media epoch changes', async () => {
    const imageUrl = 'https://www.nodeseek.com/uploads/private-topic.png';
    const callbacks = {
      onClose: jest.fn(),
      onNext: jest.fn(),
      onPrevious: jest.fn(),
      onSave: jest.fn(),
      onSelect: jest.fn()
    };
    const view = await render(
      <ForumSessionEpochProvider sessionEpochs={{ ...initialForumSessionEpochs, nodeseek: 4 }}>
        <ImagePreviewModal
          preview={{ contentSource: 'nodeseek', urls: [imageUrl], index: 0 }}
          nodeSeekMediaUserAgent="WZ-Preview-Test"
          styles={styles}
          theme={theme}
          {...callbacks}
        />
      </ForumSessionEpochProvider>
    );
    const epochFourImage = view.getByTestId('active-preview-image');
    const epochFourSource = epochFourImage.props.source;
    expect(epochFourImage.props.recyclingKey).toBe(`nodeseek:4:${imageUrl}:native`);
    expect(epochFourSource).toEqual(expect.objectContaining({
      cacheKey: `nodeseek:4:${imageUrl}`
    }));

    await view.rerender(
      <ForumSessionEpochProvider sessionEpochs={{ ...initialForumSessionEpochs, nodeseek: 5 }}>
        <ImagePreviewModal
          preview={{ contentSource: 'nodeseek', urls: [imageUrl], index: 0 }}
          nodeSeekMediaUserAgent="WZ-Preview-Test"
          styles={styles}
          theme={theme}
          {...callbacks}
        />
      </ForumSessionEpochProvider>
    );

    const epochFiveImage = view.getByTestId('active-preview-image');
    expect(epochFiveImage.props.recyclingKey).toBe(`nodeseek:5:${imageUrl}:native`);
    expect(epochFiveImage.props.source).toEqual(expect.objectContaining({
      cacheKey: `nodeseek:5:${imageUrl}`
    }));
    expect(epochFiveImage.props.source).not.toBe(epochFourSource);
    expect(epochFiveImage.props.source.headers).not.toHaveProperty('Cookie');
  });

  it('REG-TOPIC-020 recovers incompatible SVG thumbnails before they are selected', async () => {
    const firstUrl = 'https://example.com/dynamic-thumbnail-one.png';
    const secondUrl = 'https://example.com/dynamic-thumbnail-two.png';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      headers: {
        get: (name: string) => name.toLowerCase() === 'content-type' ? 'image/svg+xml' : null
      },
      ok: true,
      text: async () => '<svg xmlns="http://www.w3.org/2000/svg" width="920" height="1025"><text><a href="https://example.com"><tspan>report</tspan></a></text></svg>'
    } as Response);
    try {
      const view = await render(
        <ImagePreviewModal
          preview={{ contentSource: null, urls: [firstUrl, secondUrl], index: 0 }}
          styles={styles}
          theme={theme}
          onClose={jest.fn()}
          onNext={jest.fn()}
          onPrevious={jest.fn()}
          onSave={jest.fn()}
          onSelect={jest.fn()}
        />
      );

      await fireEvent(view.getAllByTestId('preview-thumbnail-image')[1], 'error');

      await waitFor(() => expect(view.getAllByTestId('preview-thumbnail-image')[1].props.source).toEqual(
        expect.objectContaining({ uri: expect.stringMatching(/^data:image\/svg\+xml;base64,/) })
      ));
      expect(fetchSpy).toHaveBeenCalledWith(secondUrl, expect.objectContaining({
        headers: expect.objectContaining({ Accept: expect.stringContaining('image/svg+xml') })
      }));
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
