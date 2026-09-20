import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveImageUriToLibrary } from './imageSave';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';

const native = vi.hoisted(() => ({
  createDownload: vi.fn(() => 'download-1'),
  download: vi.fn(),
  cancelDownload: vi.fn(),
  releaseDownload: vi.fn(),
  available: true
}));
vi.mock('expo', () => ({ requireOptionalNativeModule: () => (native.available ? native : null) }));

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

vi.mock('expo-media-library', () => {
  class Asset {
    static create = vi.fn();
    id: string;

    constructor(id: string) {
      this.id = id;
    }
  }

  return { Asset, requestPermissionsAsync: vi.fn() };
});

describe('image library saving', () => {
  afterEach(() => {
    setDiagnosticWriter(null);
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    native.available = true;
    native.createDownload.mockClear();
    native.cancelDownload.mockClear();
    native.releaseDownload.mockClear();
    native.download
      .mockReset()
      .mockResolvedValue({ uri: 'file:///cache/image-saves/native.png', contentType: 'image/png', byteCount: 12 });
    vi.mocked(FileSystem.deleteAsync).mockReset();
    vi.mocked(FileSystem.downloadAsync).mockReset();
    vi.mocked(FileSystem.getInfoAsync).mockReset();
    vi.mocked(FileSystem.writeAsStringAsync).mockReset();
    vi.mocked(MediaLibrary.requestPermissionsAsync).mockReset();
    vi.mocked(MediaLibrary.Asset.create).mockReset();
    vi.mocked(FileSystem.deleteAsync).mockResolvedValue(undefined);
    vi.mocked(FileSystem.writeAsStringAsync).mockResolvedValue(undefined);
    vi.mocked(MediaLibrary.Asset.create).mockResolvedValue(new MediaLibrary.Asset('content://media/external/images/1'));
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

  it.each(['图片下载失败', '下载内容不是图片'])(
    'surfaces native rejection %s and releases the download',
    async (message) => {
      native.download.mockRejectedValueOnce(new Error(message));
      await expect(saveImageUriToLibrary('https://cdn.example.com/file.jpg', publicMediaOptions)).rejects.toThrow(
        message
      );
      expect(MediaLibrary.Asset.create).not.toHaveBeenCalled();
      expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
      expect(native.releaseDownload).toHaveBeenCalledWith('download-1');
    }
  );

  it('rejects unsupported image URL schemes before downloading', async () => {
    await expect(saveImageUriToLibrary('javascript:alert(1)', publicMediaOptions)).rejects.toThrow(
      '图片地址不支持保存'
    );

    expect(MediaLibrary.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(FileSystem.downloadAsync).not.toHaveBeenCalled();
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect(MediaLibrary.Asset.create).not.toHaveBeenCalled();
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
    expect(MediaLibrary.Asset.create).toHaveBeenCalledWith('file:///cache/forum-image-1234.png');
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/forum-image-1234.png', { idempotent: true });
  });

  it('passes the native file directly to the media library and releases it afterwards', async () => {
    await saveImageUriToLibrary('https://cdn.example.com/photo.jpg', publicMediaOptions);
    expect(native.download).toHaveBeenCalledWith('download-1', 'https://cdn.example.com/photo.jpg', expect.any(Object));
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect(FileSystem.downloadAsync).not.toHaveBeenCalled();
    expect(MediaLibrary.Asset.create).toHaveBeenCalledWith('file:///cache/image-saves/native.png');
    expect(native.releaseDownload).toHaveBeenCalledWith('download-1');
  });

  it('keeps source credentials and referrer policy in the managed native request', async () => {
    await saveImageUriToLibrary('https://www.nodeseek.com/uploads/private.png', {
      mediaContext: {
        contentSource: 'nodeseek',
        sessionIdentity: 'nodeseek:4',
        referrer: { documentUrl: 'https://www.nodeseek.com/post-1' }
      },
      nodeSeekUserAgent: 'WZ-Save-Test',
      referrerPolicy: 'no-referrer'
    });
    const headers = native.download.mock.calls[0][2];
    expect(headers).toMatchObject({ 'User-Agent': 'WZ-Save-Test', 'X-WZ-Forum-Media-Source': 'nodeseek' });
    expect(headers).not.toHaveProperty('Cookie');
    expect(headers).not.toHaveProperty('Referer');
  });

  it('cancels the owned request and prevents a stale response from entering the library', async () => {
    const controller = new AbortController();
    native.download.mockImplementationOnce(async () => {
      controller.abort();
      return { uri: 'file:///cache/old.png', byteCount: 12 };
    });
    await expect(
      saveImageUriToLibrary('https://cdn.example.com/photo.jpg', { ...publicMediaOptions, signal: controller.signal })
    ).rejects.toThrow('取消');
    expect(native.cancelDownload).toHaveBeenCalledWith('download-1');
    expect(native.releaseDownload).toHaveBeenCalledWith('download-1');
    expect(MediaLibrary.Asset.create).not.toHaveBeenCalled();
  });

  it('checks the session again after file inspection before creating an asset', async () => {
    let current = true;
    vi.mocked(FileSystem.getInfoAsync).mockImplementationOnce(async () => {
      current = false;
      return { exists: true, isDirectory: false, size: 12, uri: 'file:///cache/a.png', modificationTime: 1 };
    });
    await expect(
      saveImageUriToLibrary('https://cdn.example.com/photo.jpg', {
        ...publicMediaOptions,
        assertCurrent: () => {
          if (!current) throw new Error('stale identity');
        }
      })
    ).rejects.toThrow('stale identity');
    expect(MediaLibrary.Asset.create).not.toHaveBeenCalled();
    expect(native.releaseDownload).toHaveBeenCalledWith('download-1');
  });

  it('rejects a missing native bridge without using an unmanaged downloader', async () => {
    native.available = false;
    await expect(saveImageUriToLibrary('https://cdn.example.com/photo.jpg', publicMediaOptions)).rejects.toThrow(
      '更新'
    );
    expect(FileSystem.downloadAsync).not.toHaveBeenCalled();
    expect(MediaLibrary.Asset.create).not.toHaveBeenCalled();
  });
});
