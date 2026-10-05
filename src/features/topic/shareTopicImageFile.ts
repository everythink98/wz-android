import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { nativeSecureRandomHex } from '@/platform/android/secureRandom';

const RETENTION_MS = 24 * 60 * 60 * 1000;

export async function shareTopicImageFile(
  uri: string,
  title: string,
  isCurrent: () => boolean = () => true
): Promise<void> {
  if (!isCurrent()) return;
  const available = await Sharing.isAvailableAsync();
  if (!isCurrent()) return;
  if (!available) throw new Error('当前设备不支持分享图片。');
  if (!uri.startsWith('file://')) throw new Error('分享图片必须是本机文件。');

  const original = new File(uri);
  if (!original.exists || original.size <= 0) throw new Error('分享图片已丢失或为空，请重新生成。');
  const suffix = await nativeSecureRandomHex(16);
  if (!isCurrent()) return;
  const directory = new Directory(Paths.cache, 'topic-share');
  directory.create({ intermediates: true, idempotent: true });
  const now = Date.now();
  let retainedBytes = 0;
  for (const entry of directory.list()) {
    if (!(entry instanceof File)) continue;
    const createdAt = Number(entry.name.match(/^topic-(\d+)-[a-f0-9]{32}\.png$/)?.[1]);
    if (createdAt > 0 && now - createdAt > RETENTION_MS) entry.delete();
    else if (createdAt > 0) retainedBytes += entry.size;
  }
  if (retainedBytes + original.size > 128 * 1024 * 1024) {
    throw new Error('分享图片缓存已满，请稍后重试或分享链接。');
  }

  const target = new File(directory, `topic-${now}-${suffix}.png`);
  if (target.exists) throw new Error('分享图片文件已存在，请重试。');
  try {
    await original.copy(target);
    if (!target.exists || target.size <= 0) throw new Error('图片复制失败，请重试。');
  } catch (error) {
    try {
      if (target.exists) target.delete();
    } catch {
      // Preserve the copy failure if its partial file cannot be removed.
    }
    throw error;
  }

  // The receiving app may read after the chooser closes; keep the copy until it expires.
  if (!isCurrent()) return;
  await Sharing.shareAsync(target.uri, {
    dialogTitle: title,
    mimeType: 'image/png',
    UTI: 'public.png'
  });
}
