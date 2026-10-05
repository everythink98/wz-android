import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { shareTopicImageFile } from './shareTopicImageFile';

const boundary = vi.hoisted(() => ({
  directory: '',
  failCopy: false,
  available: true,
  randomSequence: 0,
  onAvailable: () => {},
  onCopied: () => {},
  share: vi.fn(async (_uri: string, _options: unknown) => {})
}));

vi.mock('@/platform/android/secureRandom', () => ({
  nativeSecureRandomHex: async () => (++boundary.randomSequence).toString(16).padStart(32, '0')
}));
vi.mock('expo-sharing', () => ({
  isAvailableAsync: async () => {
    boundary.onAvailable();
    return boundary.available;
  },
  shareAsync: boundary.share
}));
vi.mock('expo-file-system', async () => {
  const fs = await import('node:fs');
  const { copyFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  type Part = string | { uri: string };
  const uriFor = (parts: Part[]) => {
    const [root, ...names] = parts.map((part) => (typeof part === 'string' ? part : part.uri));
    return pathToFileURL(join(fileURLToPath(root), ...names)).href;
  };
  class File {
    uri: string;
    constructor(...parts: Part[]) {
      this.uri = uriFor(parts);
    }
    get name() {
      return this.uri.split('/').at(-1);
    }
    get exists() {
      return fs.existsSync(fileURLToPath(this.uri));
    }
    get size() {
      return fs.statSync(fileURLToPath(this.uri)).size;
    }
    async copy(target: File) {
      if (boundary.failCopy) {
        fs.writeFileSync(fileURLToPath(target.uri), 'partial');
        throw new Error('disk full');
      }
      await copyFile(fileURLToPath(this.uri), fileURLToPath(target.uri));
      boundary.onCopied();
    }
    delete() {
      fs.unlinkSync(fileURLToPath(this.uri));
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: Part[]) {
      this.uri = uriFor(parts);
    }
    create() {
      fs.mkdirSync(fileURLToPath(this.uri), { recursive: true });
    }
    list() {
      return fs
        .readdirSync(fileURLToPath(this.uri), { withFileTypes: true })
        .map((entry) => (entry.isDirectory() ? new Directory(this, entry.name) : new File(this, entry.name)));
    }
  }
  return {
    Directory,
    File,
    Paths: {
      get cache() {
        return pathToFileURL(boundary.directory).href;
      }
    }
  };
});

const now = Date.parse('2026-10-02T04:00:00Z');
const retention = 24 * 60 * 60 * 1000;
const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 255]);
const image = () => {
  const path = join(boundary.directory, 'view-shot.png');
  writeFileSync(path, imageBytes);
  return pathToFileURL(path).href;
};

beforeEach(() => {
  boundary.directory = mkdtempSync(join(tmpdir(), 'wz-topic-share-'));
  boundary.failCopy = false;
  boundary.available = true;
  boundary.randomSequence = 0;
  boundary.onAvailable = () => {};
  boundary.onCopied = () => {};
  boundary.share.mockReset();
  vi.spyOn(Date, 'now').mockReturnValue(now);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(boundary.directory, { recursive: true, force: true });
});

describe('topic image sharing', () => {
  it('retains unique copies for a late receiving app after the chooser closes and the capture is released', async () => {
    const original = image();
    await shareTopicImageFile(original, '正文图片');
    await shareTopicImageFile(original, '另一张正文图片');
    rmSync(fileURLToPath(original));

    const shared = boundary.share.mock.calls.map(([uri]) => uri);
    expect(new Set(shared).size).toBe(2);
    for (const uri of shared) {
      expect(readFileSync(fileURLToPath(uri))).toEqual(imageBytes);
      expect(fileURLToPath(uri)).toContain(join(boundary.directory, 'topic-share'));
    }
    expect(boundary.share.mock.calls[0]?.[1]).toEqual({
      dialogTitle: '正文图片',
      mimeType: 'image/png',
      UTI: 'public.png'
    });
  });

  it('prunes only owned PNG files older than 24 hours within the share directory', async () => {
    const folder = join(boundary.directory, 'topic-share');
    mkdirSync(folder);
    const oldName = `topic-${now - retention - 1}-${'a'.repeat(32)}.png`;
    const retainedNames = [
      `topic-${now - retention}-${'b'.repeat(32)}.png`,
      `topic-${now + 1}-${'c'.repeat(32)}.png`,
      `topic-${now - retention - 1}-other.png`,
      `topic-${now - retention - 1}-${'d'.repeat(32)}.txt`,
      'someone-elses.png'
    ];
    for (const name of [oldName, ...retainedNames]) writeFileSync(join(folder, name), imageBytes);
    const childDirectory = join(folder, `topic-${now - retention - 1}-${'e'.repeat(32)}.png`);
    mkdirSync(childDirectory);
    writeFileSync(join(childDirectory, oldName), imageBytes);
    writeFileSync(join(boundary.directory, oldName), imageBytes);

    await shareTopicImageFile(image(), '正文图片');

    expect(existsSync(join(folder, oldName))).toBe(false);
    for (const name of retainedNames) expect(readFileSync(join(folder, name))).toEqual(imageBytes);
    expect(readFileSync(join(childDirectory, oldName))).toEqual(imageBytes);
    expect(readFileSync(join(boundary.directory, oldName))).toEqual(imageBytes);
  });

  it('reports unavailable sharing without copying or opening the chooser', async () => {
    boundary.available = false;
    const original = image();

    await expect(shareTopicImageFile(original, '正文图片')).rejects.toThrow('当前设备不支持分享图片。');

    expect(boundary.share).not.toHaveBeenCalled();
    expect(readdirSync(boundary.directory)).toEqual(['view-shot.png']);
    expect(readFileSync(fileURLToPath(original))).toEqual(imageBytes);
  });

  it('reports a full 128 MiB cache without deleting an unexpired image or copying a new one', async () => {
    const folder = join(boundary.directory, 'topic-share');
    mkdirSync(folder);
    const retainedName = `topic-${now}-${'f'.repeat(32)}.png`;
    const retainedPath = join(folder, retainedName);
    writeFileSync(retainedPath, imageBytes);
    truncateSync(retainedPath, 128 * 1024 * 1024);
    const original = image();

    await expect(shareTopicImageFile(original, '正文图片')).rejects.toThrow('分享图片缓存已满，请稍后重试或分享链接。');

    expect(boundary.share).not.toHaveBeenCalled();
    expect(readdirSync(folder)).toEqual([retainedName]);
    expect(statSync(retainedPath).size).toBe(128 * 1024 * 1024);
    expect(readFileSync(fileURLToPath(original))).toEqual(imageBytes);
  });

  it('removes a partial failed copy while preserving the original capture', async () => {
    boundary.failCopy = true;
    const original = image();

    await expect(shareTopicImageFile(original, '正文图片')).rejects.toThrow('disk full');

    expect(boundary.share).not.toHaveBeenCalled();
    expect(readdirSync(join(boundary.directory, 'topic-share'))).toEqual([]);
    expect(readFileSync(fileURLToPath(original))).toEqual(imageBytes);
  });

  it('does not copy or open sharing when its preview has already closed', async () => {
    await shareTopicImageFile(image(), '正文图片', () => false);

    expect(boundary.share).not.toHaveBeenCalled();
    expect(readdirSync(boundary.directory)).toEqual(['view-shot.png']);
  });

  it('ignores a late availability result after its preview closes', async () => {
    let current = true;
    boundary.available = false;
    boundary.onAvailable = () => {
      current = false;
    };

    await expect(shareTopicImageFile(image(), '正文图片', () => current)).resolves.toBeUndefined();

    expect(boundary.share).not.toHaveBeenCalled();
    expect(readdirSync(boundary.directory)).toEqual(['view-shot.png']);
  });

  it('does not open sharing when its preview closes during the file copy', async () => {
    let current = true;
    boundary.onCopied = () => {
      current = false;
    };

    await shareTopicImageFile(image(), '正文图片', () => current);

    expect(boundary.share).not.toHaveBeenCalled();
  });
});
