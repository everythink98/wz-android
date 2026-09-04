import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(__dirname, '../..');
const patchDir = path.join(rootDir, 'patches');
const patches = readdirSync(patchDir)
  .filter((name) => name.endsWith('.patch'))
  .sort();

describe('installed dependency patches', () => {
  it.each(patches)('%s matches the installed dependency', (patch) => {
    expect(() =>
      execFileSync('git', ['apply', '--reverse', '--check', '--unsafe-paths', '--', path.join(patchDir, patch)], {
        cwd: rootDir,
        stdio: 'pipe'
      })
    ).not.toThrow();
  });
});
