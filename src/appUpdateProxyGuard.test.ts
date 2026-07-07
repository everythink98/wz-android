import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(__dirname, '..');

function readSource(...parts: string[]) {
  return readFileSync(path.join(rootDir, ...parts), 'utf8');
}

describe('app update proxy guard', () => {
  it('checks proxy readiness before native APK download starts', () => {
    const controller = readSource('src', 'app', 'useAppUpdateController.ts');
    const checkIndex = controller.indexOf('await beforeDownload?.();');
    const downloadIndex = controller.indexOf('FileSystem.createDownloadResumable');

    expect(controller).toContain('beforeDownload?: () => Promise<void>');
    expect(checkIndex).toBeGreaterThanOrEqual(0);
    expect(downloadIndex).toBeGreaterThan(checkIndex);
  });
});
