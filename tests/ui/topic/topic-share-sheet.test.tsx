import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React, { type ComponentProps } from 'react';
import { PixelRatio, Platform, StyleSheet } from 'react-native';
import { TouchableRipple } from 'react-native-paper';
import type { Image } from 'expo-image';
import { TopicShareSheet } from '@/features/topic/components/TopicShareSheet';
import type { TopicDetail } from '@/domain/forum/models';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import { act, fireEvent, render, within } from '../render';

const mockCaptureRef = jest.fn<(...args: unknown[]) => Promise<string>>();
const mockReleaseCapture = jest.fn<(uri: string) => void>();
const mockShareAsync = jest.fn<(uri: string, options: unknown) => Promise<void>>();
const mockCreateAsset = jest.fn<(uri: string) => Promise<void>>();
const mockRequestPermissions = jest.fn<() => Promise<{ granted: boolean }>>();
const mockFiles = new Map<string, Uint8Array>();
let mockCopyWait: Promise<void> | undefined;

jest.mock('react-native-view-shot', () => ({
  captureRef: (...args: unknown[]) => mockCaptureRef(...args),
  releaseCapture: (uri: string) => mockReleaseCapture(uri)
}));
jest.mock('expo-image', () => {
  const ReactModule = require('react') as typeof React;
  const { View } = require('react-native') as typeof import('react-native');
  return { Image: (props: ComponentProps<typeof Image>) => ReactModule.createElement(View, props) };
});
jest.mock('expo-sharing', () => ({
  isAvailableAsync: async () => true,
  shareAsync: (uri: string, options: unknown) => mockShareAsync(uri, options)
}));
jest.mock('expo-media-library', () => ({
  Asset: { create: (uri: string) => mockCreateAsset(uri) },
  requestPermissionsAsync: () => mockRequestPermissions()
}));
jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual<typeof import('expo-file-system/legacy')>('expo-file-system/legacy'),
  getInfoAsync: async (uri: string) => ({
    uri,
    exists: mockFiles.has(uri),
    isDirectory: false,
    size: mockFiles.get(uri)?.length || 0,
    modificationTime: 0
  })
}));
jest.mock('@/platform/android/secureRandom', () => ({
  nativeSecureRandomHex: async () => 'a'.repeat(32)
}));
jest.mock('expo-file-system', () => {
  type MockPart = string | { uri: string };
  class File {
    uri: string;
    constructor(...parts: MockPart[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    get size() {
      return mockFiles.get(this.uri)?.length || 0;
    }
    async copy(target: File) {
      const bytes = mockFiles.get(this.uri);
      if (!bytes) throw new Error('File missing');
      await mockCopyWait;
      mockFiles.set(target.uri, bytes.slice());
    }
    delete() {
      mockFiles.delete(this.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: MockPart[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    create() {}
    list() {
      return [];
    }
  }
  return { Directory, File, Paths: { cache: 'file:///cache' } };
});

const captureUri = 'file:///cache/capture.png';
const imageBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const mediaContext: ForumMediaRequestContext = { contentSource: 'v2ex', sessionIdentity: 'public:0' };
const topic: TopicDetail = {
  source: 'v2ex',
  id: 'share-proof',
  title: '完整主帖长图',
  author: '正文作者',
  createdAt: '2026-10-02T04:00:00Z',
  url: 'https://www.v2ex.com/t/share-proof',
  contentHtml: '<p>主帖开头</p><p>主帖结尾</p>',
  replies: []
};

async function layout(view: Awaited<ReturnType<typeof render>>, height = 1200) {
  await fireEvent(view.getByTestId('topic-share-content'), 'contentSizeChange', 400, height);
}

async function settleFrames() {
  await act(async () => jest.advanceTimersByTime(40));
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['performance'] });
  jest.spyOn(PixelRatio, 'get').mockReturnValue(1);
  mockCaptureRef.mockReset().mockResolvedValue(captureUri);
  mockReleaseCapture.mockReset().mockImplementation((uri) => {
    mockFiles.delete(uri);
  });
  mockShareAsync.mockReset().mockResolvedValue(undefined);
  mockCreateAsset.mockReset().mockResolvedValue(undefined);
  mockRequestPermissions.mockReset().mockResolvedValue({ granted: true });
  mockFiles.clear();
  mockFiles.set(captureUri, imageBytes);
  mockCopyWait = undefined;
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('Topic body image sharing', () => {
  it('renders the complete opening and waits for every displayed image and content layout before sharing one PNG', async () => {
    const view = await render(
      <TopicShareSheet
        topic={{
          ...topic,
          contentHtml:
            '<p>主帖开头</p><img src="https://example.com/first.png" alt="首图">' +
            Array.from({ length: 60 }, (_, index) => `<p>完整正文段落 ${index}</p>`).join('') +
            '<table><tr><th>表格标题</th></tr><tr><td>末行单元格</td></tr></table>' +
            '<pre><code>最后一行代码</code></pre>' +
            '<img src="https://example.com/last.png" alt="尾图"><p>主帖结尾</p>',
          replies: [{ author: '评论作者', contentHtml: '<p>不包含评论</p>', createdAt: '' }]
        }}
        mediaContext={mediaContext}
        onClose={jest.fn()}
      />
    );
    expect(view.getByText('主帖开头')).toBeTruthy();
    expect(view.getByText('完整正文段落 59')).toBeTruthy();
    expect(view.getByText('表格标题')).toBeTruthy();
    expect(view.getByText('末行单元格')).toBeTruthy();
    expect(view.getByText('最后一行代码')).toBeTruthy();
    expect(view.getByText('主帖结尾')).toBeTruthy();
    expect(view.queryByText('不包含评论')).toBeNull();
    expect(view.getByText(topic.url)).toBeTruthy();
    const content = within(view.getByTestId('topic-share-content'));
    const actions = within(view.getByTestId('topic-share-actions'));
    expect(content.queryByTestId('topic-share-actions')).toBeNull();
    expect(content.queryByRole('button', { name: '分享图片' })).toBeNull();
    expect(content.queryByRole('button', { name: '保存到相册' })).toBeNull();
    expect(actions.getByRole('button', { name: '分享图片' })).toBeDisabled();
    expect(actions.getByRole('button', { name: '保存到相册' })).toBeDisabled();
    expect(view.getByRole('button', { name: '分享图片' })).toBeDisabled();

    for (const name of ['首图', '尾图']) {
      await fireEvent(view.getByLabelText(name), 'load', { source: { width: 640, height: 480 } });
    }
    expect(view.getByRole('button', { name: '分享图片' })).toBeDisabled();
    await fireEvent(view.getByLabelText('首图'), 'display');
    expect(view.getByRole('button', { name: '分享图片' })).toBeDisabled();
    await fireEvent(view.getByLabelText('尾图'), 'display');
    expect(view.getByRole('button', { name: '分享图片' })).toBeDisabled();
    await layout(view, 6000);
    expect(view.getByRole('button', { name: '分享图片' })).toBeEnabled();

    const pendingShare = Promise.withResolvers<void>();
    mockShareAsync.mockReturnValueOnce(pendingShare.promise);
    const button = view.getByRole('button', { name: '分享图片' });
    await fireEvent.press(button);
    await fireEvent.press(button);
    await settleFrames();
    expect(mockCaptureRef).toHaveBeenCalledTimes(1);
    expect(mockCaptureRef).toHaveBeenCalledWith(expect.anything(), {
      format: 'png',
      result: 'tmpfile',
      snapshotContentContainer: true
    });
    expect(mockShareAsync).toHaveBeenCalledTimes(1);
    const [sharedUri, options] = mockShareAsync.mock.calls[0];
    expect(sharedUri).not.toBe(captureUri);
    expect(mockFiles.get(sharedUri)).toEqual(imageBytes);
    expect(options).toEqual({ dialogTitle: topic.title, mimeType: 'image/png', UTI: 'public.png' });
    expect(mockReleaseCapture).not.toHaveBeenCalled();
    await act(async () => {
      pendingShare.resolve();
      await pendingShare.promise;
    });
    expect(mockReleaseCapture).toHaveBeenCalledWith(captureUri);
    expect(mockFiles.get(sharedUri)).toEqual(imageBytes);
  });

  it.each(['failure', 'timeout'])(
    'reloads images after %s and ignores callbacks from the old attempt',
    async (failure) => {
      const view = await render(
        <TopicShareSheet
          topic={{ ...topic, contentHtml: '<p>正文</p><img src="https://example.com/image.png" alt="正文图">' }}
          mediaContext={mediaContext}
          onClose={jest.fn()}
        />
      );
      await layout(view);
      const oldImage: ComponentProps<typeof Image> = view.getByLabelText('正文图').props;
      if (failure === 'failure') await fireEvent(view.getByLabelText('正文图'), 'error', { error: 'load failed' });
      else await act(async () => jest.advanceTimersByTime(30_000));
      await fireEvent(view.getByLabelText('正文图'), 'display');
      expect(view.getByRole('alert')).toHaveTextContent(failure === 'failure' ? /有图片未能加载/ : /图片加载超时/);
      expect(view.getByRole('button', { name: '分享图片' })).toBeDisabled();
      await fireEvent.press(view.getByRole('button', { name: '分享图片' }));
      await settleFrames();
      expect(mockCaptureRef).not.toHaveBeenCalled();
      expect(mockShareAsync).not.toHaveBeenCalled();

      await fireEvent.press(view.getByRole('button', { name: '重新加载图片' }));
      expect(view.queryByRole('alert')).toBeNull();
      await layout(view);
      await act(() => {
        oldImage.onDisplay?.();
        oldImage.onError?.({ error: 'old request failed' });
      });
      expect(view.queryByRole('alert')).toBeNull();
      expect(view.getByRole('button', { name: '分享图片' })).toBeDisabled();
      expect(view.getByRole('button', { name: '保存到相册' })).toBeDisabled();
      await fireEvent(view.getByLabelText('正文图'), 'load', { source: { width: 640, height: 480 } });
      expect(view.getByRole('button', { name: '分享图片' })).toBeDisabled();
      await fireEvent(view.getByLabelText('正文图'), 'display');
      await act(() => oldImage.onError?.({ error: 'late old request failed' }));
      expect(view.queryByRole('alert')).toBeNull();
      expect(view.getByRole('button', { name: '分享图片' })).toBeEnabled();
      expect(view.getByRole('button', { name: '保存到相册' })).toBeEnabled();
    }
  );

  it('saves the captured PNG on Android 35 and releases it only after the media library finishes', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.spyOn(Platform, 'Version', 'get').mockReturnValue(35);
    // Paper computes this platform capability once at module evaluation.
    jest.replaceProperty(TouchableRipple, 'supported', true);
    const saving = Promise.withResolvers<void>();
    mockCreateAsset.mockReturnValueOnce(saving.promise);
    const view = await render(<TopicShareSheet topic={topic} mediaContext={mediaContext} onClose={jest.fn()} />);
    await layout(view);
    for (const name of ['保存到相册', '分享图片']) {
      const button = view.getByRole('button', { name });
      expect(button.props.nativeForegroundAndroid).toBeUndefined();
      expect(button.props.nativeBackgroundAndroid).toBeUndefined();
    }
    await fireEvent.press(view.getByRole('button', { name: '保存到相册' }));
    await settleFrames();
    expect(mockCaptureRef).toHaveBeenCalledTimes(1);
    expect(mockCreateAsset).toHaveBeenCalledWith(captureUri);
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(view.getByRole('button', { name: '保存到相册' })).toBeDisabled();
    expect(view.getByRole('button', { name: '分享图片' })).toBeDisabled();
    expect(mockReleaseCapture).not.toHaveBeenCalled();
    expect(mockFiles.get(captureUri)).toEqual(imageBytes);
    await act(async () => {
      saving.resolve();
      await saving.promise;
    });
    expect(view.getByText('已保存到相册')).toBeTruthy();
    expect(mockReleaseCapture).toHaveBeenCalledWith(captureUri);
    expect(mockFiles.has(captureUri)).toBe(false);
    expect(view.getByRole('button', { name: '保存到相册' })).toBeDisabled();
    expect(view.getByRole('button', { name: '分享图片' })).toBeEnabled();
  });

  it('waits for redisplay after decoding restarts without unloading images already admitted', async () => {
    const names = ['图片一', '图片二', '图片三', '图片四', '图片五'];
    const view = await render(
      <TopicShareSheet
        topic={{
          ...topic,
          contentHtml: names.map((name, index) => `<img src="https://example.com/${index}.png" alt="${name}">`).join('')
        }}
        mediaContext={mediaContext}
        onClose={jest.fn()}
      />
    );
    await layout(view);
    expect(view.getByLabelText('图片五').props.source).toBeNull();
    for (const name of names) {
      await fireEvent(view.getByLabelText(name), 'load', { source: { width: 640, height: 480 } });
      await fireEvent(view.getByLabelText(name), 'display');
    }
    expect(view.getByRole('button', { name: '分享图片' })).toBeEnabled();

    for (const name of names) await fireEvent(view.getByLabelText(name), 'loadStart');
    expect(view.getByLabelText('图片五').props.source.uri).toBe('https://example.com/4.png');
    expect(view.getByRole('button', { name: '分享图片' })).toBeDisabled();
    await fireEvent.press(view.getByRole('button', { name: '分享图片' }));
    await settleFrames();
    expect(mockCaptureRef).not.toHaveBeenCalled();
    for (const name of names) {
      await fireEvent(view.getByLabelText(name), 'load', { source: { width: 320, height: 240 } });
      expect(view.getByRole('button', { name: '分享图片' })).toBeDisabled();
      await fireEvent(view.getByLabelText(name), 'display');
    }
    expect(view.getByRole('button', { name: '分享图片' })).toBeEnabled();
  });

  it('fits images within table cells and preserves small emoji dimensions', async () => {
    const view = await render(
      <TopicShareSheet
        topic={{
          ...topic,
          contentHtml:
            '<table><tr><td><img src="https://example.com/table.png" alt="表格图"></td>' +
            '<td><img src="https://example.com/emoji.png" width="20" height="20" alt="表情图"></td></tr></table>'
        }}
        mediaContext={mediaContext}
        onClose={jest.fn()}
      />
    );
    for (const name of ['表格图', '表情图']) {
      const container = view.getByLabelText(name).parent;
      if (!container) throw new Error('Image container missing');
      await fireEvent(container, 'layout', { nativeEvent: { layout: { width: 96, height: 120, x: 0, y: 0 } } });
    }
    await fireEvent(view.getByLabelText('表格图'), 'load', { source: { width: 640, height: 480 } });
    await fireEvent(view.getByLabelText('表情图'), 'load', { source: { width: 128, height: 128 } });
    expect(StyleSheet.flatten(view.getByLabelText('表格图').props.style)).toMatchObject({ width: 96, height: 72 });
    expect(StyleSheet.flatten(view.getByLabelText('表情图').props.style)).toMatchObject({ width: 20, height: 20 });
  });

  it('rejects an oversized native bitmap, including layout growth while a capture is queued', async () => {
    const view = await render(<TopicShareSheet topic={topic} mediaContext={mediaContext} onClose={jest.fn()} />);
    await layout(view);
    await fireEvent.press(view.getByRole('button', { name: '分享图片' }));
    await layout(view, 100_000);
    expect(view.getByRole('alert')).toHaveTextContent(/正文过长/);
    await settleFrames();
    expect(mockCaptureRef).not.toHaveBeenCalled();
    expect(mockShareAsync).not.toHaveBeenCalled();
  });

  it('shows a capture failure and lets the user retry successfully', async () => {
    mockCaptureRef.mockRejectedValueOnce(new Error('capture unavailable'));
    const view = await render(<TopicShareSheet topic={topic} mediaContext={mediaContext} onClose={jest.fn()} />);
    await layout(view);
    await fireEvent.press(view.getByRole('button', { name: '分享图片' }));
    await settleFrames();
    expect(view.getByRole('alert')).toHaveTextContent(/capture unavailable/);
    expect(view.getByRole('button', { name: '分享图片' })).toBeEnabled();
    expect(mockShareAsync).not.toHaveBeenCalled();
    await fireEvent.press(view.getByRole('button', { name: '分享图片' }));
    await settleFrames();
    expect(mockCaptureRef).toHaveBeenCalledTimes(2);
    expect(mockShareAsync).toHaveBeenCalledTimes(1);
    expect(view.queryByRole('alert')).toBeNull();
  });

  it.each(['close button', 'Android back', 'Android back to options', 'unmount'])(
    'does not share a late capture after %s',
    async (action) => {
      const pendingCapture = Promise.withResolvers<string>();
      mockCaptureRef.mockReturnValueOnce(pendingCapture.promise);
      const onClose = jest.fn();
      const onBack = jest.fn();
      const view = await render(
        <TopicShareSheet
          topic={topic}
          mediaContext={mediaContext}
          onClose={onClose}
          onBack={action === 'close button' || action === 'Android back to options' ? onBack : undefined}
        />
      );
      await layout(view);
      await fireEvent.press(view.getByRole('button', { name: '分享图片' }));
      await settleFrames();
      expect(mockCaptureRef).toHaveBeenCalledTimes(1);
      if (action === 'close button') await fireEvent.press(view.getByRole('button', { name: '关闭' }));
      else if (action === 'Android back' || action === 'Android back to options') {
        const [modal] = view.container.queryAll(({ props }) => typeof props.onRequestClose === 'function');
        await fireEvent(modal, 'requestClose');
      } else await view.unmount();
      expect(onClose).toHaveBeenCalledTimes(action === 'close button' || action === 'Android back' ? 1 : 0);
      expect(onBack).toHaveBeenCalledTimes(action === 'Android back to options' ? 1 : 0);
      await act(async () => {
        pendingCapture.resolve(captureUri);
        await pendingCapture.promise;
      });
      expect(mockShareAsync).not.toHaveBeenCalled();
      expect(mockReleaseCapture).toHaveBeenCalledWith(captureUri);
    }
  );

  it('does not open the share chooser if the user closes while the image file is being copied', async () => {
    const copying = Promise.withResolvers<void>();
    mockCopyWait = copying.promise;
    const onClose = jest.fn();
    const view = await render(<TopicShareSheet topic={topic} mediaContext={mediaContext} onClose={onClose} />);
    await layout(view);
    await fireEvent.press(view.getByRole('button', { name: '分享图片' }));
    await settleFrames();
    expect(mockCaptureRef).toHaveBeenCalledTimes(1);
    expect(mockReleaseCapture).not.toHaveBeenCalled();
    await fireEvent.press(view.getByRole('button', { name: '关闭' }));
    await act(async () => {
      copying.resolve();
      await copying.promise;
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(mockReleaseCapture).toHaveBeenCalledWith(captureUri);
  });
});
