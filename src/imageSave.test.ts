import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveImageUriToLibrary } from './imageSave';

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
    vi.mocked(FileSystem.downloadAsync).mockResolvedValue({
      headers: {},
      mimeType: 'text/html',
      status: 404,
      uri: 'file:///cache/forum-image-1234.jpg'
    });

    await expect(saveImageUriToLibrary('https://cdn.example.com/missing.jpg')).rejects.toThrow('图片下载失败');

    expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled();
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/forum-image-1234.jpg', { idempotent: true });
  });

  it('rejects non-image remote responses and deletes the temporary file', async () => {
    vi.mocked(FileSystem.downloadAsync).mockResolvedValue({
      headers: {},
      mimeType: 'text/html',
      status: 200,
      uri: 'file:///cache/forum-image-1234.jpg'
    });

    await expect(saveImageUriToLibrary('https://cdn.example.com/file.jpg')).rejects.toThrow('下载内容不是图片');

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

  it('saves data images and removes the temporary file afterwards', async () => {
    await saveImageUriToLibrary('data:image/png;base64,abc123');

    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith('file:///cache/forum-image-1234.png', 'abc123', { encoding: FileSystem.EncodingType.Base64 });
    expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith('file:///cache/forum-image-1234.png');
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/forum-image-1234.png', { idempotent: true });
  });
});
