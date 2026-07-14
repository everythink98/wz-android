import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { findBrokenDocReferences, findKnowledgeContractErrors } from './check-docs.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

async function createFixture(markdown) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'wz-check-docs-'));
  temporaryDirectories.push(rootDir);
  await mkdir(path.join(rootDir, 'docs'));
  await mkdir(path.join(rootDir, 'android'));
  await mkdir(path.join(rootDir, 'src'));
  await writeFile(path.join(rootDir, 'README.md'), '# fixture\n');
  await writeFile(path.join(rootDir, 'src', 'existing.ts'), 'export {};\n');
  await writeFile(path.join(rootDir, 'docs', 'guide.md'), markdown);
  return rootDir;
}

test('allows documented release output paths before generated APKs exist', async () => {
  const rootDir = await createFixture([
    'Output directory: `android/app/build/outputs/apk/release/`.',
    'Published APK: `android/app/build/outputs/apk/release/app-arm64-v8a-release.apk`.',
    'Smoke APK: `android/app/build/outputs/apk/release/app-x86_64-smoke-dev.apk`.'
  ].join('\n'));

  const errors = findBrokenDocReferences(rootDir, ['docs/guide.md']);

  assert.deepEqual(errors, []);
});

test('reports broken relative Markdown links', async () => {
  const rootDir = await createFixture([
    '[existing](../README.md)',
    '[missing](missing.md)',
    '[external](https://example.com/docs)'
  ].join('\n'));

  const errors = findBrokenDocReferences(rootDir, ['docs/guide.md']);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /docs\/guide\.md:2.*missing\.md/);
});

test('reports broken backticked repository paths without requiring local-only files', async () => {
  const rootDir = await createFixture([
    'Existing: `src/existing.ts`.',
    'Missing: `src/missing.ts`.',
    'Local-only baseline: `docs/emulator-baseline.md`.',
    'Command: `npm run typecheck`.'
  ].join('\n'));

  const errors = findBrokenDocReferences(rootDir, ['docs/guide.md']);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /docs\/guide\.md:2.*src\/missing\.ts/);
});

test('reports a broken backticked repository file at the repository root', async () => {
  const rootDir = await createFixture('Missing root file: `MISSING.md`.\n');

  const errors = findBrokenDocReferences(rootDir, ['docs/guide.md']);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /docs\/guide\.md:1.*MISSING\.md/);
});

test('reports a broken repository path inside a fenced test command', async () => {
  const rootDir = await createFixture([
    '```powershell',
    'npm test -- src/existing.ts src/missing.test.ts',
    '```'
  ].join('\n'));

  const errors = findBrokenDocReferences(rootDir, ['docs/guide.md']);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /docs\/guide\.md:2.*src\/missing\.test\.ts/);
});

async function createKnowledgeFixture({ productMap, regressionCorpus = '', source = 'export {};\n' }) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'wz-knowledge-contract-'));
  temporaryDirectories.push(rootDir);
  await mkdir(path.join(rootDir, 'docs'));
  await mkdir(path.join(rootDir, 'src'));
  await writeFile(path.join(rootDir, 'docs', 'product-map.md'), productMap);
  await writeFile(path.join(rootDir, 'docs', 'regression-corpus.md'), regressionCorpus);
  await writeFile(path.join(rootDir, 'src', 'screen.tsx'), source);
  return rootDir;
}

test('reports duplicate capability definitions in the product map', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: [
      '## 能力清单',
      '| `FEED-01` | first |',
      '| `FEED-01` | duplicate |',
      '## 四站能力矩阵'
    ].join('\n')
  });

  assert.match(findKnowledgeContractErrors(rootDir).join('\n'), /FEED-01.*重复定义/);
});

test('reports regression entries that reference an unknown capability', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: [
      '## 能力清单',
      '| `FEED-01` | first |',
      '## 四站能力矩阵'
    ].join('\n'),
    regressionCorpus: '`REG-FEED-001` protects `FEED-99`.\n'
  });

  assert.match(findKnowledgeContractErrors(rootDir).join('\n'), /FEED-99.*不存在/);
});

test('does not parse a REG id as a product capability id', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: [
      '## 能力清单',
      '| `FEED-01` | first |',
      '## 四站能力矩阵'
    ].join('\n'),
    regressionCorpus: '`REG-FEED-001` protects `FEED-01`.\n'
  });

  assert.deepEqual(findKnowledgeContractErrors(rootDir), []);
});

test('reports retired user-facing authentication terms in source files', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: [
      '## 能力清单',
      '| `ACCOUNT-01` | first |',
      '## 四站能力矩阵'
    ].join('\n'),
    source: "export const label = '身份识别保护';\n"
  });

  assert.match(findKnowledgeContractErrors(rootDir).join('\n'), /src\/screen\.tsx:1.*身份识别保护/);
});
