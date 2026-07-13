import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCleanWorktree,
  assertVersionState,
  validateVersionState
} from './release-guards.mjs';

test('rejects dirty release worktrees with the changed paths', () => {
  assert.throws(
    () => assertCleanWorktree({
      phase: '发布前',
      runGit: () => ' M src/app.ts\n?? scratch.txt\n'
    }),
    /发布前.*src\/app\.ts.*scratch\.txt/s
  );
});

test('allows rebuilding the exact published release', () => {
  assert.deepEqual(validateVersionState({
    current: { version: '1.3.62', versionCode: 66 },
    head: 'release-commit',
    latest: { version: '1.3.62', versionCode: 66, commit: 'release-commit', tag: 'v1.3.62' },
    releaseCandidate: true
  }), []);
});

test('rejects a release candidate that reuses the published versionCode', () => {
  assert.match(validateVersionState({
    current: { version: '1.3.63', versionCode: 66 },
    head: 'candidate-commit',
    latest: { version: '1.3.62', versionCode: 66, commit: 'release-commit', tag: 'v1.3.62' },
    releaseCandidate: true
  }).join('\n'), /versionCode 66.*v1\.3\.62.*66/);
});

test('rejects releasing new commits under an already published version', () => {
  assert.match(validateVersionState({
    current: { version: '1.3.62', versionCode: 66 },
    head: 'candidate-commit',
    latest: { version: '1.3.62', versionCode: 66, commit: 'release-commit', tag: 'v1.3.62' },
    releaseCandidate: true
  }).join('\n'), /v1\.3\.62 已发布/);
});

test('allows ordinary consistency checks while development still uses the published version', () => {
  assert.deepEqual(validateVersionState({
    current: { version: '1.3.62', versionCode: 66 },
    head: 'development-commit',
    latest: { version: '1.3.62', versionCode: 66, commit: 'release-commit', tag: 'v1.3.62' },
    releaseCandidate: false
  }), []);
});

test('never treats incomplete shallow history as authoritative release history', () => {
  const runGit = (_rootDir, args) => {
    if (args.join(' ') === 'rev-parse --is-shallow-repository') {
      return 'true';
    }
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  };

  assert.doesNotThrow(() => assertVersionState({
    rootDir: '/repo',
    current: { version: '1.3.63', versionCode: 67 },
    releaseCandidate: false,
    runGit
  }));
  assert.throws(() => assertVersionState({
    rootDir: '/repo',
    current: { version: '1.3.63', versionCode: 67 },
    releaseCandidate: true,
    runGit
  }), /shallow.*git fetch --unshallow --tags/is);
});

test('compares against release tags outside HEAD ancestry', () => {
  const commands = [];
  const runGit = (_rootDir, args) => {
    commands.push(args);
    const command = args.join(' ');
    if (command === 'rev-parse --is-shallow-repository') return 'false';
    if (command === 'rev-parse HEAD') return 'candidate';
    if (command === 'tag --list v* --sort=-version:refname') return 'v1.3.62';
    if (command === 'show v1.3.62:app.json') {
      return JSON.stringify({ expo: { version: '1.3.62', android: { versionCode: 66 } } });
    }
    if (command === 'rev-list -n 1 v1.3.62') return 'other-branch-release';
    throw new Error(`unexpected git command: ${command}`);
  };

  assert.throws(() => assertVersionState({
    rootDir: '/repo',
    current: { version: '1.3.63', versionCode: 66 },
    releaseCandidate: true,
    runGit
  }), /versionCode 66.*v1\.3\.62/s);
  assert.equal(commands.some((args) => args.includes('--merged')), false);
});
