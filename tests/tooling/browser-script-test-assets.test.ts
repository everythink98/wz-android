import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { NODESEEK_BROWSER_FETCH_SCRIPT } from '@/features/account/useHiddenBrowserFetchController';

const root = process.cwd();
const scratch = path.join(root, '.codex-tmp');
mkdirSync(scratch, { recursive: true });
const directory = mkdtempSync(path.join(scratch, 'browser-script-test-assets-owner-'));
const generator = path.join(root, 'scripts/prepare-browser-script-test-assets.mjs');
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

afterAll(() => {
  if (path.dirname(directory) !== scratch) throw new Error('Refusing unexpected test output cleanup');
  rmSync(directory, { recursive: true, force: true });
});

describe('Android browser-script test assets', () => {
  it('materializes the actual export and hashes its evaluated inputs without claiming device verification', () => {
    const output = path.join(directory, 'actual-export');
    const prepared = JSON.parse(
      execFileSync(process.execPath, [generator, '--output', output], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true
      })
    );
    const asset = readFileSync(
      path.join(prepared.assetsDirectory, 'nodeseek-browser-script/production-script.js'),
      'utf8'
    );
    const manifestBytes = readFileSync(path.join(prepared.assetsDirectory, 'nodeseek-browser-script/manifest.json'));
    const manifest = JSON.parse(manifestBytes.toString()) as {
      sourceEntry: string;
      sourceSha256: string;
      scriptSha256: string;
      inputs: { file: string; sha256: string }[];
      deviceEvidence: string;
    };
    expect(asset).toBe(NODESEEK_BROWSER_FETCH_SCRIPT);
    expect(prepared.status).toBe('PREPARED_NOT_DEVICE_VERIFIED');
    expect(prepared.scriptSha256).toBe(digest(asset));
    expect(prepared.manifestSha256).toBe(digest(manifestBytes));
    expect(manifest.scriptSha256).toBe(prepared.scriptSha256);
    expect(manifest.sourceSha256).toBe(digest(readFileSync(path.join(root, manifest.sourceEntry))));
    expect(manifest.inputs.map((input) => input.file)).toContain('src/domain/forum/accessRequirements.ts');
    for (const input of manifest.inputs) {
      expect(input.sha256).toBe(digest(readFileSync(path.join(root, input.file))));
    }
    expect(manifest.deviceEvidence).toBe('NOT_VERIFIED');
  });

  it('refuses existing or nonignored output destinations without replacing their content', () => {
    const marker = path.join(directory, 'existing-marker.txt');
    writeFileSync(marker, 'preserve');
    const outside = path.join(root, 'browser-script-assets-must-not-exist');
    expect(existsSync(outside)).toBe(false);
    for (const output of [directory, scratch, outside]) {
      const result = spawnSync(process.execPath, [generator, '--output', output], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true
      });
      expect(result.status).not.toBe(0);
    }
    expect(readFileSync(marker, 'utf8')).toBe('preserve');
    expect(existsSync(outside)).toBe(false);
  });
});
