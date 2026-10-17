import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React, { type ComponentProps } from 'react';
import { PixelRatio, Platform, StyleSheet } from 'react-native';
import { TouchableRipple } from 'react-native-paper';
import type { Image } from 'expo-image';
import { TopicShareSheet } from '@/features/topic/components/TopicShareSheet';
import type { TopicDetail } from '@/domain/forum/models';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import { act, fireEvent, render, within } from '../render';

const native = require('react-native') as typeof import('react-native');

const mockCaptureRef = jest.fn<(...args: unknown[]) => Promise<string>>();
const mockReleaseCapture = jest.fn<(uri: string) => void>();
const mockShareAsync = jest.fn<(uri: string, options: unknown) => Promise<void>>();
const mockCreateAsset = jest.fn<(uri: string) => Promise<void>>();
const mockRequestPermissions = jest.fn<() => Promise<{ granted: boolean }>>();
const mockLongCapture = jest.fn<(id: string, tag: number) => Promise<{ uri: string; width: number; height: number }>>();
const mockCancelLongCapture = jest.fn<(id: string) => void>();
const mockReleaseLongCapture = jest.fn<(id: string) => void>();
let mockLongCaptureAvailable = true;
const mockFiles = new Map<string, Uint8Array>();
let mockCopyWait: Promise<void> | undefined;
const mockLoadImage = jest.fn<
  (
    source: { uri: string },
    options: unknown
  ) => Promise<{
    uri: string;
    width: number;
    height: number;
    release: () => void;
  }>
>();
const mockReleaseImage = jest.fn<() => void>();

jest.mock('expo', () => {
  const actual = jest.requireActual<typeof import('expo')>('expo');
  return {
    ...actual,
    requireOptionalNativeModule: (name: string) =>
      name === 'TopicShareCapture'
        ? mockLongCaptureAvailable
          ? {
              createCapture: () => 'long-capture',
              capture: (id: string, tag: number) => mockLongCapture(id, tag),
              cancelCapture: (id: string) => mockCancelLongCapture(id),
              releaseCapture: (id: string) => mockReleaseLongCapture(id)
            }
          : null
        : actual.requireOptionalNativeModule(name)
  };
});

jest.mock('react-native-view-shot', () => ({
  captureRef: (...args: unknown[]) => mockCaptureRef(...args),
  releaseCapture: (uri: string) => mockReleaseCapture(uri)
}));
jest.mock('expo-image', () => {
  const ReactModule = require('react') as typeof React;
  const { View } = require('react-native') as typeof import('react-native');
  return {
    Image: Object.assign((props: ComponentProps<typeof Image>) => ReactModule.createElement(View, props), {
      loadAsync: (source: { uri: string }, options: unknown) => mockLoadImage(source, options)
    })
  };
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
  jest.spyOn(native, 'findNodeHandle').mockReturnValue(73);
  mockCaptureRef.mockReset().mockResolvedValue(captureUri);
  mockLongCapture.mockReset().mockImplementation(async () => {
    mockFiles.set(captureUri, imageBytes);
    return { uri: captureUri, width: 1080, height: 30_000 };
  });
  mockCancelLongCapture.mockReset();
  mockLongCaptureAvailable = true;
  mockReleaseLongCapture.mockReset().mockImplementation(() => mockFiles.delete(captureUri));
  mockReleaseCapture.mockReset().mockImplementation((uri) => {
    mockFiles.delete(uri);
  });
  mockShareAsync.mockReset().mockResolvedValue(undefined);
  mockCreateAsset.mockReset().mockResolvedValue(undefined);
  mockRequestPermissions.mockReset().mockResolvedValue({ granted: true });
  mockFiles.clear();
  mockFiles.set(captureUri, imageBytes);
  mockCopyWait = undefined;
  mockReleaseImage.mockReset();
  mockLoadImage.mockReset().mockImplementation(async ({ uri }) => ({
    uri,
    width: 640,
    height: 480,
    release: mockReleaseImage
  }));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('Topic body image sharing', () => {
  it('uses reading typography and preserves safe alignment and emphasis in the exported body', async () => {
    const view = await render(
      <TopicShareSheet
        topic={{
          ...topic,
          contentHtml:
            '<h2>正文标题</h2><p style="text-align:right;color:#bb2222"><span class="bbcode-s">右对齐删除线</span></p><font size="5">放大正文</font>'
        }}
        mediaContext={mediaContext}
        onClose={jest.fn()}
      />
    );
    expect(view.getByText('正文标题')).toHaveStyle({ fontSize: 20, lineHeight: 28 });
    expect(view.getByText('右对齐删除线')).toHaveStyle({ textDecorationLine: 'line-through' });
    expect(view.getByText('右对齐删除线')).toHaveStyle({ textAlign: 'right', color: '#bb2222' });
    expect(view.getByText('放大正文')).toHaveStyle({ fontSize: 24, lineHeight: 36 });
  });

  it.each([1, 3])('exports short Android bodies at the same resolution at density %s', async (density) => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.spyOn(PixelRatio, 'get').mockReturnValue(density);
    jest.spyOn(native, 'findNodeHandle').mockReturnValue(73);
    const view = await render(<TopicShareSheet topic={topic} mediaContext={mediaContext} onClose={jest.fn()} />);
    await layout(view, 1200);
    await fireEvent.press(view.getByRole('button', { name: '分享图片' }));
    await settleFrames();
    expect(mockLongCapture).toHaveBeenCalledWith('long-capture', 73);
    expect(mockCaptureRef).not.toHaveBeenCalled();
    expect(mockShareAsync).toHaveBeenCalledTimes(1);
  });

  it('decodes original image detail for export independently of the preview size and releases it on unmount', async () => {
    const view = await render(
      <TopicShareSheet
        topic={{ ...topic, contentHtml: '<img src="https://example.com/original.png" alt="原图">' }}
        mediaContext={mediaContext}
        onClose={jest.fn()}
      />
    );
    expect(mockLoadImage).toHaveBeenCalledWith(expect.objectContaining({ uri: 'https://example.com/original.png' }), {
      maxWidth: 1440,
      maxHeight: 10_000
    });
    await view.unmount();
    expect(mockReleaseImage).toHaveBeenCalledTimes(1);
  });

  it('releases a decode that finishes after closing and lets a failed decode reload', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof mockLoadImage>>>();
    mockLoadImage.mockReturnValueOnce(pending.promise);
    const props = {
      topic: { ...topic, contentHtml: '<img src="https://example.com/original.png" alt="原图">' },
      mediaContext,
      onClose: jest.fn()
    };
    const closing = await render(<TopicShareSheet {...props} />);
    await closing.unmount();
    await act(async () => {
      pending.resolve({
        uri: 'https://example.com/original.png',
        width: 1440,
        height: 1000,
        release: mockReleaseImage
      });
      await pending.promise;
    });
    expect(mockReleaseImage).toHaveBeenCalledTimes(1);

    mockLoadImage.mockRejectedValueOnce(new Error('decode failed'));
    const retrying = await render(<TopicShareSheet {...props} />);
    expect(retrying.getByRole('alert')).toHaveTextContent(/有图片未能加载/);
    expect(retrying.getByRole('button', { name: '分享图片' })).toBeDisabled();
    await fireEvent.press(retrying.getByRole('button', { name: '重新加载图片' }));
    await fireEvent(retrying.getByLabelText('原图'), 'load', { source: { width: 1440, height: 1000 } });
    await fireEvent(retrying.getByLabelText('原图'), 'display');
    await layout(retrying);
    expect(retrying.queryByRole('alert')).toBeNull();
    expect(retrying.getByRole('button', { name: '分享图片' })).toBeEnabled();
  });

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
    expect(mockLongCapture).toHaveBeenCalledTimes(1);
    expect(mockLongCapture).toHaveBeenCalledWith('long-capture', 73);
    expect(mockShareAsync).toHaveBeenCalledTimes(1);
    const [sharedUri, options] = mockShareAsync.mock.calls[0];
    expect(sharedUri).not.toBe(captureUri);
    expect(mockFiles.get(sharedUri)).toEqual(imageBytes);
    expect(options).toEqual({ dialogTitle: topic.title, mimeType: 'image/png', UTI: 'public.png' });
    expect(mockReleaseLongCapture).not.toHaveBeenCalled();
    await act(async () => {
      pendingShare.resolve();
      await pendingShare.promise;
    });
    expect(mockReleaseLongCapture).toHaveBeenCalledWith('long-capture');
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
    expect(mockLongCapture).toHaveBeenCalledTimes(1);
    expect(mockCreateAsset).toHaveBeenCalledWith(captureUri);
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(view.getByRole('button', { name: '保存到相册' })).toBeDisabled();
    expect(view.getByRole('button', { name: '分享图片' })).toBeDisabled();
    expect(mockReleaseLongCapture).not.toHaveBeenCalled();
    expect(mockFiles.get(captureUri)).toEqual(imageBytes);
    await act(async () => {
      saving.resolve();
      await saving.promise;
    });
    expect(view.getByText('已保存到相册')).toBeTruthy();
    expect(mockReleaseLongCapture).toHaveBeenCalledWith('long-capture');
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

  it('keeps a table image mixed with text within the measured cell content width', async () => {
    const view = await render(
      <TopicShareSheet
        topic={{
          ...topic,
          contentHtml:
            '<table><tr><td>前<img src="https://example.com/mixed.png" alt="混排图">后</td><td>另一列</td></tr></table>'
        }}
        mediaContext={mediaContext}
        onClose={jest.fn()}
      />
    );
    await fireEvent(view.getAllByTestId('topic-share-cell-content')[0], 'layout', {
      nativeEvent: { layout: { width: 96, height: 120, x: 0, y: 0 } }
    });
    await fireEvent(view.getByLabelText('混排图'), 'load', { source: { width: 640, height: 480 } });
    expect(view.getByLabelText('混排图')).toHaveStyle({ width: 96, height: 72 });
  });

  it.each(['share', 'save'])(
    'exports the complete high density long body through bounded capture for %s',
    async (action) => {
      jest.replaceProperty(Platform, 'OS', 'android');
      jest.spyOn(Platform, 'Version', 'get').mockReturnValue(35);
      jest.spyOn(PixelRatio, 'get').mockReturnValue(3);
      jest.spyOn(native, 'findNodeHandle').mockReturnValue(73);
      const view = await render(<TopicShareSheet topic={topic} mediaContext={mediaContext} onClose={jest.fn()} />);
      await layout(view, action === 'share' ? 10_000 : 1200);
      expect(view.getByText('主帖开头')).toBeTruthy();
      expect(view.getByText('主帖结尾')).toBeTruthy();
      const button = view.getByRole('button', { name: action === 'share' ? '分享图片' : '保存到相册' });
      expect(button).toBeEnabled();
      const consumer = Promise.withResolvers<void>();
      if (action === 'share') mockShareAsync.mockReturnValueOnce(consumer.promise);
      else mockCreateAsset.mockReturnValueOnce(consumer.promise);
      await fireEvent.press(button);
      // Read the current size after the final layout, including growth while export waits for its frames.
      await layout(view, 100_000);
      await settleFrames();
      expect(view.queryByRole('alert')).toBeNull();
      expect(mockLongCapture).toHaveBeenCalledWith('long-capture', 73);
      expect(mockCaptureRef).not.toHaveBeenCalled();
      expect(mockShareAsync).toHaveBeenCalledTimes(action === 'share' ? 1 : 0);
      expect(mockCreateAsset).toHaveBeenCalledTimes(action === 'save' ? 1 : 0);
      expect(mockReleaseLongCapture).not.toHaveBeenCalled();
      expect(mockFiles.get(captureUri)).toEqual(imageBytes);
      await act(async () => {
        consumer.resolve();
        await consumer.promise;
      });
      expect(mockReleaseLongCapture).toHaveBeenCalledWith('long-capture');
    }
  );

  it('cancels a long capture on close and releases a late result without sharing it', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.spyOn(native, 'findNodeHandle').mockReturnValue(73);
    const pending = Promise.withResolvers<{ uri: string; width: number; height: number }>();
    mockLongCapture.mockReturnValueOnce(pending.promise);
    const view = await render(<TopicShareSheet topic={topic} mediaContext={mediaContext} onClose={jest.fn()} />);
    await layout(view, 100_000);
    await fireEvent.press(view.getByRole('button', { name: '分享图片' }));
    await settleFrames();
    expect(mockLongCapture).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByRole('button', { name: '关闭' }));
    expect(mockCancelLongCapture).toHaveBeenCalledWith('long-capture');
    await act(async () => {
      pending.resolve({ uri: captureUri, width: 1080, height: 100_000 });
      await pending.promise;
    });
    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(mockReleaseLongCapture).toHaveBeenCalledWith('long-capture');
  });

  it('invalidates a long capture if an image starts decoding again, even when it redisplays before capture returns', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.spyOn(native, 'findNodeHandle').mockReturnValue(73);
    const pending = Promise.withResolvers<{ uri: string; width: number; height: number }>();
    mockLongCapture.mockReturnValueOnce(pending.promise);
    const view = await render(
      <TopicShareSheet
        topic={{ ...topic, contentHtml: '<p>正文</p><img src="https://example.com/image.png" alt="正文图">' }}
        mediaContext={mediaContext}
        onClose={jest.fn()}
      />
    );
    await fireEvent(view.getByLabelText('正文图'), 'load', { source: { width: 640, height: 480 } });
    await fireEvent(view.getByLabelText('正文图'), 'display');
    await layout(view, 100_000);
    await fireEvent.press(view.getByRole('button', { name: '分享图片' }));
    await settleFrames();
    expect(mockLongCapture).toHaveBeenCalledTimes(1);
    await fireEvent(view.getByLabelText('正文图'), 'loadStart');
    expect(mockCancelLongCapture).toHaveBeenCalledWith('long-capture');
    await fireEvent(view.getByLabelText('正文图'), 'display');
    await act(async () => {
      pending.resolve({ uri: captureUri, width: 1080, height: 100_000 });
      await pending.promise;
    });
    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(mockReleaseLongCapture).toHaveBeenCalledWith('long-capture');
    expect(view.getByRole('button', { name: '分享图片' })).toBeEnabled();
  });

  it('invalidates a long capture when decoding restarts and redisplays in one React batch', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.spyOn(native, 'findNodeHandle').mockReturnValue(73);
    const pending = Promise.withResolvers<{ uri: string; width: number; height: number }>();
    mockLongCapture.mockReturnValueOnce(pending.promise);
    const view = await render(
      <TopicShareSheet
        topic={{ ...topic, contentHtml: '<p>正文</p><img src="https://example.com/image.png" alt="正文图">' }}
        mediaContext={mediaContext}
        onClose={jest.fn()}
      />
    );
    await fireEvent(view.getByLabelText('正文图'), 'load', { source: { width: 640, height: 480 } });
    await fireEvent(view.getByLabelText('正文图'), 'display');
    await layout(view, 100_000);
    await fireEvent.press(view.getByRole('button', { name: '分享图片' }));
    await settleFrames();
    expect(mockLongCapture).toHaveBeenCalledTimes(1);
    const image: ComponentProps<typeof Image> = view.getByLabelText('正文图').props;
    await act(() => {
      image.onLoadStart?.();
      image.onDisplay?.();
    });
    await act(async () => {
      pending.resolve({ uri: captureUri, width: 1080, height: 100_000 });
      await pending.promise;
    });
    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(mockCancelLongCapture).toHaveBeenCalledWith('long-capture');
    expect(mockReleaseLongCapture).toHaveBeenCalledWith('long-capture');
    expect(view.getByRole('button', { name: '分享图片' })).toBeEnabled();
  });

  it.each(['standard', 'long', 'unsupported'])(
    'shows a %s capture failure and lets the user retry successfully',
    async (mode) => {
      const long = mode !== 'standard';
      if (!long) jest.replaceProperty(Platform, 'OS', 'ios');
      if (long) {
        jest.replaceProperty(Platform, 'OS', 'android');
        jest.spyOn(native, 'findNodeHandle').mockReturnValue(73);
        if (mode === 'unsupported') mockLongCaptureAvailable = false;
        else mockLongCapture.mockRejectedValueOnce(new Error('capture unavailable'));
      } else mockCaptureRef.mockRejectedValueOnce(new Error('capture unavailable'));
      const view = await render(<TopicShareSheet topic={topic} mediaContext={mediaContext} onClose={jest.fn()} />);
      await layout(view, long ? 100_000 : 1200);
      await fireEvent.press(view.getByRole('button', { name: '分享图片' }));
      await settleFrames();
      expect(view.getByRole('alert')).toHaveTextContent(
        mode === 'unsupported' ? /请更新后重试/ : /capture unavailable/
      );
      expect(view.getByRole('button', { name: '分享图片' })).toBeEnabled();
      expect(mockShareAsync).not.toHaveBeenCalled();
      if (mode === 'long') expect(mockReleaseLongCapture).toHaveBeenCalledWith('long-capture');
      mockLongCaptureAvailable = true;
      await fireEvent.press(view.getByRole('button', { name: '分享图片' }));
      await settleFrames();
      expect(long ? mockLongCapture : mockCaptureRef).toHaveBeenCalledTimes(mode === 'unsupported' ? 1 : 2);
      expect(mockShareAsync).toHaveBeenCalledTimes(1);
      expect(view.queryByRole('alert')).toBeNull();
    }
  );

  it.each(['close button', 'Android back', 'Android back to options', 'unmount'])(
    'does not share a late capture after %s',
    async (action) => {
      jest.replaceProperty(Platform, 'OS', 'ios');
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
    expect(mockLongCapture).toHaveBeenCalledTimes(1);
    expect(mockReleaseLongCapture).not.toHaveBeenCalled();
    await fireEvent.press(view.getByRole('button', { name: '关闭' }));
    await act(async () => {
      copying.resolve();
      await copying.promise;
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(mockReleaseLongCapture).toHaveBeenCalledWith('long-capture');
  });
});
