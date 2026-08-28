import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveImageUriToLibrary } from './imageSave';
import type { Fetcher } from '@/platform/network/request';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';

const publicMediaOptions = {
  mediaContext: {
    contentSource: null,
    sessionIdentity: 'public:0'
  }
} as const;

vi.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///docs/',
  deleteAsync: vi.fn(),
  downloadAsync: vi.fn(),
  getInfoAsync: vi.fn(),
  writeAsStringAsync: vi.fn()
}));

vi.mock('expo-media-library', () => ({
  requestPermissionsAsync: vi.fn(),
  saveToLibraryAsync: vi.fn()
}));

describe('image library saving', () => {
  afterEach(() => {
    setDiagnosticWriter(null);
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    vi.mocked(FileSystem.deleteAsync).mockReset();
    vi.mocked(FileSystem.downloadAsync).mockReset();
    vi.mocked(FileSystem.getInfoAsync).mockReset();
    vi.mocked(FileSystem.writeAsStringAsync).mockReset();
    vi.mocked(MediaLibrary.requestPermissionsAsync).mockReset();
    vi.mocked(MediaLibrary.saveToLibraryAsync).mockReset();
    vi.mocked(FileSystem.deleteAsync).mockResolvedValue(undefined);
    vi.mocked(FileSystem.writeAsStringAsync).mockResolvedValue(undefined);
    vi.mocked(MediaLibrary.saveToLibraryAsync).mockResolvedValue(undefined);
    vi.mocked(MediaLibrary.requestPermissionsAsync).mockResolvedValue({
      granted: true
    } as MediaLibrary.PermissionResponse);
    vi.mocked(FileSystem.getInfoAsync).mockResolvedValue({
      exists: true,
      isDirectory: false,
      modificationTime: 1,
      size: 12,
      uri: 'file:///cache/forum-image-1234.jpg'
    });
  });

  it('rejects failed remote image downloads and deletes the temporary file', async () => {
    const fetcher = vi.fn<Fetcher>(
      async () =>
        new Response('missing', {
          headers: { 'content-type': 'text/html' },
          status: 404
        })
    );

    await expect(
      saveImageUriToLibrary('https://cdn.example.com/missing.jpg', publicMediaOptions, fetcher)
    ).rejects.toThrow('图片下载失败');

    expect(fetcher).toHaveBeenCalledWith(
      'https://cdn.example.com/missing.jpg',
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled();
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/forum-image-1234.jpg', { idempotent: true });
  });

  it('rejects non-image remote responses and deletes the temporary file', async () => {
    const fetcher = vi.fn<Fetcher>(
      async () =>
        new Response('<html></html>', {
          headers: { 'content-type': 'text/html' },
          status: 200
        })
    );

    await expect(
      saveImageUriToLibrary('https://cdn.example.com/file.jpg', publicMediaOptions, fetcher)
    ).rejects.toThrow('下载内容不是图片');

    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled();
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/forum-image-1234.jpg', { idempotent: true });
  });

  it('rejects unsupported image URL schemes before downloading', async () => {
    await expect(saveImageUriToLibrary('javascript:alert(1)', publicMediaOptions)).rejects.toThrow(
      '图片地址不支持保存'
    );

    expect(MediaLibrary.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(FileSystem.downloadAsync).not.toHaveBeenCalled();
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled();
  });

  it('records permission failure without exporting the image URL', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    vi.mocked(MediaLibrary.requestPermissionsAsync).mockResolvedValue({
      granted: false
    } as MediaLibrary.PermissionResponse);

    await expect(
      saveImageUriToLibrary('https://cdn.example.com/private-title-91827.jpg', publicMediaOptions)
    ).rejects.toThrow('没有图片保存权限');

    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toEqual([
      expect.objectContaining({ area: 'media', operation: 'save-image', phase: 'intent', channel: 'remote' }),
      expect.objectContaining({ phase: 'credential', isGranted: false }),
      expect.objectContaining({ phase: 'finish', outcome: 'blocked', reason: 'permission_denied' })
    ]);
    expect(JSON.stringify(events)).not.toContain('private-title-91827');
  });

  it('saves data images and removes the temporary file afterwards', async () => {
    await saveImageUriToLibrary('data:image/png;base64,abc123', publicMediaOptions);

    expect(MediaLibrary.requestPermissionsAsync).toHaveBeenCalledWith(false, ['photo']);
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith('file:///cache/forum-image-1234.png', 'abc123', {
      encoding: FileSystem.EncodingType.Base64
    });
    expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith('file:///cache/forum-image-1234.png');
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/forum-image-1234.png', { idempotent: true });
  });

  it('saves remote images through the provided fetcher', async () => {
    const fetcher = vi.fn<Fetcher>(
      async () =>
        new Response('image-bytes', {
          headers: { 'content-type': 'image/jpeg' },
          status: 200
        })
    );

    await saveImageUriToLibrary('https://cdn.example.com/photo.jpg', publicMediaOptions, fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      'https://cdn.example.com/photo.jpg',
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
    expect(FileSystem.downloadAsync).not.toHaveBeenCalled();
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
      'file:///cache/forum-image-1234.jpg',
      Buffer.from('image-bytes').toString('base64'),
      { encoding: FileSystem.EncodingType.Base64 }
    );
    expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith('file:///cache/forum-image-1234.jpg');
  });

  it('saves with the same element Referrer Policy as the displayed image', async () => {
    const fetcher = vi.fn<Fetcher>(
      async () =>
        new Response('image-bytes', {
          headers: { 'content-type': 'image/png' },
          status: 200
        })
    );

    await saveImageUriToLibrary(
      'https://i.imgur.com/topic.png',
      {
        mediaContext: {
          contentSource: 'v2ex',
          referrer: { documentUrl: 'https://www.v2ex.com/t/1233346' },
          sessionIdentity: 'v2ex:7'
        },
        referrerPolicy: 'no-referrer'
      },
      fetcher
    );

    expect((fetcher.mock.calls as unknown as [string, RequestInit][])[0]?.[1]?.headers).not.toHaveProperty('Referer');
  });

  it('keeps NodeSeek media credentials when saving a protected image', async () => {
    const fetcher = vi.fn<Fetcher>(
      async () =>
        new Response('image-bytes', {
          headers: { 'content-type': 'image/png' },
          status: 200
        })
    );

    await saveImageUriToLibrary(
      'https://www.nodeseek.com/uploads/private-topic.png',
      {
        mediaContext: {
          contentSource: 'nodeseek',
          sessionIdentity: 'nodeseek:4'
        },
        nodeSeekUserAgent: 'WZ-Save-Test'
      },
      fetcher
    );

    expect(fetcher).toHaveBeenCalledWith(
      'https://www.nodeseek.com/uploads/private-topic.png',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': 'WZ-Save-Test',
          'X-WZ-Forum-Media-Source': 'nodeseek'
        }),
        signal: expect.any(AbortSignal)
      })
    );
    expect((fetcher.mock.calls as unknown as [string, RequestInit][])[0]?.[1]?.headers).not.toHaveProperty('Cookie');
  });

  it('preserves modern remote image extensions when saving', async () => {
    const fetcher = vi.fn<Fetcher>(
      async () =>
        new Response('avif-bytes', {
          headers: { 'content-type': 'image/avif' },
          status: 200
        })
    );

    await saveImageUriToLibrary('https://cdn.example.com/photo.avif#original', publicMediaOptions, fetcher);

    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
      'file:///cache/forum-image-1234.avif',
      Buffer.from('avif-bytes').toString('base64'),
      { encoding: FileSystem.EncodingType.Base64 }
    );
    expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith('file:///cache/forum-image-1234.avif');
  });

  it('prefers the response image type when the URL suffix is misleading', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const fetcher = vi.fn<Fetcher>(
      async () =>
        new Response(svg, {
          headers: { 'content-type': 'image/svg+xml; charset=utf-8' },
          status: 200
        })
    );

    await saveImageUriToLibrary('https://cdn.example.com/dynamic-report.png', publicMediaOptions, fetcher);

    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
      'file:///cache/forum-image-1234.svg',
      Buffer.from(svg).toString('base64'),
      { encoding: FileSystem.EncodingType.Base64 }
    );
    expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith('file:///cache/forum-image-1234.svg');
  });

  it('recognizes the legacy SVG response type used by the compatible preview', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const fetcher = vi.fn<Fetcher>(
      async () =>
        new Response(svg, {
          headers: { 'content-type': 'application/svg+xml' },
          status: 200
        })
    );

    await saveImageUriToLibrary('https://cdn.example.com/dynamic-report.png', publicMediaOptions, fetcher);

    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
      'file:///cache/forum-image-1234.svg',
      Buffer.from(svg).toString('base64'),
      { encoding: FileSystem.EncodingType.Base64 }
    );
  });

  it('times out a remote image download when native fetch never settles', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<Fetcher>(() => new Promise<Response>(() => {}));
    try {
      const save = saveImageUriToLibrary('https://cdn.example.com/stuck.jpg', publicMediaOptions, fetcher);
      const observed = Promise.race([
        save.then(
          () => 'saved',
          (error: unknown) => (error instanceof Error ? error.message : String(error))
        ),
        new Promise<string>((resolve) => setTimeout(() => resolve('still-pending'), 16_000))
      ]);

      await vi.advanceTimersByTimeAsync(16_000);

      await expect(observed).resolves.toBe('请求超时，请稍后重试');
    } finally {
      vi.useRealTimers();
    }
  });
});
