import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveImageUriToLibrary } from './imageSave';
import type { Fetcher } from './request';
import { setDiagnosticWriter } from './diagnostics';

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
    vi.mocked(MediaLibrary.requestPermissionsAsync).mockResolvedValue({ granted: true } as MediaLibrary.PermissionResponse);
    vi.mocked(FileSystem.getInfoAsync).mockResolvedValue({
      exists: true,
      isDirectory: false,
      modificationTime: 1,
      size: 12,
      uri: 'file:///cache/forum-image-1234.jpg'
    });
  });

  it('rejects failed remote image downloads and deletes the temporary file', async () => {
    const fetcher = vi.fn<Fetcher>(async () => new Response('missing', {
      headers: { 'content-type': 'text/html' },
      status: 404
    }));

    await expect(saveImageUriToLibrary('https://cdn.example.com/missing.jpg', fetcher)).rejects.toThrow('图片下载失败');

    expect(fetcher).toHaveBeenCalledWith('https://cdn.example.com/missing.jpg', undefined);
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled();
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/forum-image-1234.jpg', { idempotent: true });
  });

  it('rejects non-image remote responses and deletes the temporary file', async () => {
    const fetcher = vi.fn<Fetcher>(async () => new Response('<html></html>', {
      headers: { 'content-type': 'text/html' },
      status: 200
    }));

    await expect(saveImageUriToLibrary('https://cdn.example.com/file.jpg', fetcher)).rejects.toThrow('下载内容不是图片');

    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled();
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/forum-image-1234.jpg', { idempotent: true });
  });

  it('rejects unsupported image URL schemes before downloading', async () => {
    await expect(saveImageUriToLibrary('javascript:alert(1)')).rejects.toThrow('图片地址不支持保存');

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
    vi.mocked(MediaLibrary.requestPermissionsAsync).mockResolvedValue({ granted: false } as MediaLibrary.PermissionResponse);

    await expect(saveImageUriToLibrary('https://cdn.example.com/private-title-91827.jpg')).rejects.toThrow('没有图片保存权限');

    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toEqual([
      expect.objectContaining({ area: 'media', operation: 'save-image', phase: 'intent', channel: 'remote' }),
      expect.objectContaining({ phase: 'credential', isGranted: false }),
      expect.objectContaining({ phase: 'finish', outcome: 'blocked', reason: 'permission_denied' })
    ]);
    expect(JSON.stringify(events)).not.toContain('private-title-91827');
  });

  it('saves data images and removes the temporary file afterwards', async () => {
    await saveImageUriToLibrary('data:image/png;base64,abc123');

    expect(MediaLibrary.requestPermissionsAsync).toHaveBeenCalledWith(false, ['photo']);
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith('file:///cache/forum-image-1234.png', 'abc123', { encoding: FileSystem.EncodingType.Base64 });
    expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith('file:///cache/forum-image-1234.png');
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/forum-image-1234.png', { idempotent: true });
  });

  it('saves remote images through the provided fetcher', async () => {
    const fetcher = vi.fn<Fetcher>(async () => new Response('image-bytes', {
      headers: { 'content-type': 'image/jpeg' },
      status: 200
    }));

    await saveImageUriToLibrary('https://cdn.example.com/photo.jpg', fetcher);

    expect(fetcher).toHaveBeenCalledWith('https://cdn.example.com/photo.jpg', undefined);
    expect(FileSystem.downloadAsync).not.toHaveBeenCalled();
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
      'file:///cache/forum-image-1234.jpg',
      Buffer.from('image-bytes').toString('base64'),
      { encoding: FileSystem.EncodingType.Base64 }
    );
    expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith('file:///cache/forum-image-1234.jpg');
  });

  it('keeps NodeSeek credentials when saving a protected image', async () => {
    const fetcher = vi.fn<Fetcher>(async () => new Response('image-bytes', {
      headers: { 'content-type': 'image/jpeg' },
      status: 200
    }));

    await saveImageUriToLibrary(
      'https://www.nodeseek.com/api/attachments/123',
      fetcher,
      undefined,
      'session=node',
      'NodeSeek UA'
    );

    expect(fetcher).toHaveBeenCalledWith(
      'https://www.nodeseek.com/api/attachments/123',
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: 'session=node',
          'User-Agent': 'NodeSeek UA'
        })
      })
    );
  });
});
