import { Directory, File, Paths } from 'expo-file-system';
import { nativeSecureRandomHex } from '@/platform/android/secureRandom';

const LEASE_MS = 24 * 60 * 60 * 1000;
const MAX_FILES = 32;
const MAX_BYTES = 128 * 1024 * 1024;

function exportDirectory() {
  return new Directory(Paths.document, 'diagnostic-exports');
}

export function pruneDiagnosticExports(now = Date.now()) {
  const directory = exportDirectory();
  if (!directory.exists) return;
  for (const file of directory.list()) {
    if (!(file instanceof File)) continue;
    const createdAt = Number(file.name.match(/^diagnostic-(\d+)-/)?.[1]);
    if (createdAt > 0 && now - createdAt >= LEASE_MS) file.delete();
  }
}

export async function createDiagnosticExport(content: string) {
  const suffix = await nativeSecureRandomHex(16);
  const directory = exportDirectory();
  directory.create({ intermediates: true, idempotent: true });
  const now = Date.now();
  pruneDiagnosticExports(now);
  const existing = directory.list().filter((entry): entry is File => entry instanceof File);
  const bytes = new TextEncoder().encode(content);
  if (existing.length >= MAX_FILES || existing.reduce((sum, file) => sum + file.size, 0) + bytes.length > MAX_BYTES) {
    throw new Error('诊断导出保留空间已满，请在一天后重试。');
  }
  const file = new File(directory, `diagnostic-${now}-${suffix}.txt`);
  try {
    file.create();
    file.write(bytes);
    return file;
  } catch (error) {
    try {
      if (file.exists) file.delete();
    } catch {
      /* Preserve the write failure. */
    }
    throw error;
  }
}
