import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { findBrokenDocReferences, findKnowledgeContractErrors } from './check-docs.mjs';

const temporaryDirectories = [];

function regressionEntry(id, capability = 'ACCOUNT-01', status = 'RESOLVED', owner = 'tests/canonical.test.ts') {
  return [
    `## \`${id}\` known issue`,
    '',
    '| 字段 | 内容 |',
    '| --- | --- |',
    `| 状态 | \`${status}\` |`,
    `| 能力 ID | \`${capability}\` |`,
    '| 历史症状与根因 | historical symptom; root cause seam. |',
    `| 当前 owner | \`${owner}\` |`,
    ''
  ].join('\n');
}

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
  const rootDir = await createFixture(
    [
      'Output directory: `android/app/build/outputs/apk/release/`.',
      'Published APK: `android/app/build/outputs/apk/release/app-arm64-v8a-release.apk`.',
      'Smoke APK: `android/app/build/outputs/apk/release/app-x86_64-smoke-dev.apk`.'
    ].join('\n')
  );

  const errors = findBrokenDocReferences(rootDir, ['docs/guide.md']);

  assert.deepEqual(errors, []);
});

test('reports broken relative Markdown links', async () => {
  const rootDir = await createFixture(
    ['[existing](../README.md)', '[missing](missing.md)', '[external](https://example.com/docs)'].join('\n')
  );

  const errors = findBrokenDocReferences(rootDir, ['docs/guide.md']);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /docs\/guide\.md:2.*missing\.md/);
});

test('reports broken backticked repository paths without requiring local-only files', async () => {
  const rootDir = await createFixture(
    [
      'Existing: `src/existing.ts`.',
      'Missing: `src/missing.ts`.',
      'Local-only baseline: `docs/emulator-baseline.md`.',
      'Command: `npm run typecheck`.'
    ].join('\n')
  );

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
  const rootDir = await createFixture(
    ['```powershell', 'npm test -- src/existing.ts src/missing.test.ts', '```'].join('\n')
  );

  const errors = findBrokenDocReferences(rootDir, ['docs/guide.md']);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /docs\/guide\.md:2.*src\/missing\.test\.ts/);
});

async function createKnowledgeFixture({
  productMap,
  regressionCorpus = '',
  source = 'export {};\n',
  expectedFailure,
  markdown,
  packageScripts
}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'wz-knowledge-contract-'));
  temporaryDirectories.push(rootDir);
  await mkdir(path.join(rootDir, 'docs'));
  await mkdir(path.join(rootDir, 'src'));
  await writeFile(path.join(rootDir, 'docs', 'product-map.md'), productMap);
  await writeFile(path.join(rootDir, 'docs', 'regression-corpus.md'), regressionCorpus);
  await writeFile(path.join(rootDir, 'src', 'screen.tsx'), source);
  if (markdown !== undefined) {
    await writeFile(path.join(rootDir, 'docs', 'guide.md'), markdown);
  }
  if (packageScripts !== undefined) {
    await writeFile(path.join(rootDir, 'package.json'), JSON.stringify({ scripts: packageScripts }));
  }
  if (expectedFailure) {
    await mkdir(path.join(rootDir, 'tests'));
    await writeFile(path.join(rootDir, 'tests', 'known-failure.test.tsx'), expectedFailure);
  }
  return rootDir;
}

test('reports duplicate capability definitions in the product map', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: ['## 能力清单', '| `FEED-01` | first |', '| `FEED-01` | duplicate |', '## 四站能力矩阵'].join('\n')
  });

  assert.match(findKnowledgeContractErrors(rootDir).join('\n'), /FEED-01.*重复定义/);
});

test('reports regression entries that reference an unknown capability', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: ['## 能力清单', '| `FEED-01` | first |', '## 四站能力矩阵'].join('\n'),
    regressionCorpus: '`REG-FEED-001` protects `FEED-99`.\n'
  });

  assert.match(findKnowledgeContractErrors(rootDir).join('\n'), /FEED-99.*不存在/);
});

test('reports tracked Markdown references to undefined npm scripts', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: ['## 能力清单', '| `RELEASE-01` | first |', '## 四站能力矩阵'].join('\n'),
    markdown: ['Run npm run verify.', '运行 npm run missing。', '`npm run verify`'].join('\n'),
    packageScripts: { verify: 'echo ok' }
  });

  const errors = findKnowledgeContractErrors(rootDir, ['docs/guide.md']);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /docs\/guide\.md:2.*npm script missing.*不存在/);
});

test('reports unknown capability references including shorthand without parsing scenario ids', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: ['## 能力清单', '| `ACCOUNT-01` | first |', '## 四站能力矩阵'].join('\n'),
    regressionCorpus: regressionEntry('REG-ACCOUNT-001'),
    markdown: '`ACCOUNT-01/99` `LIVE-ACCOUNT-99` `REG-ACCOUNT-001`\n'
  });

  const errors = findKnowledgeContractErrors(rootDir, ['docs/guide.md']);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /docs\/guide\.md:1.*ACCOUNT-99.*不存在/);
});

test('reports unknown capability references in cross-family shorthand', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: ['## 能力清单', '| `FEED-01` | first |', '| `ACCOUNT-01` | second |', '## 四站能力矩阵'].join('\n'),
    markdown: '`ACCOUNT-01/FEED-99`\n'
  });

  const errors = findKnowledgeContractErrors(rootDir, ['docs/guide.md']);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /docs\/guide\.md:1.*FEED-99.*不存在/);
});

test('ignores technical identifiers and validates capability numbers of any length', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: ['## 能力清单', '| `ACCOUNT-100` | first |', '## 四站能力矩阵'].join('\n'),
    markdown: '`API-35` `UTF-16` `ACCOUNT-100` `ACCOUNT-999`\n'
  });

  const errors = findKnowledgeContractErrors(rootDir, ['docs/guide.md']);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /docs\/guide\.md:1.*ACCOUNT-999.*不存在/);
});

test('reports unknown regression references including shorthand', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: ['## 能力清单', '| `ACCOUNT-01` | first |', '## 四站能力矩阵'].join('\n'),
    regressionCorpus: regressionEntry('REG-ACCOUNT-001'),
    markdown: '`REG-ACCOUNT-001/999`\n'
  });

  const errors = findKnowledgeContractErrors(rootDir, ['docs/guide.md']);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /docs\/guide\.md:1.*REG-ACCOUNT-999.*不存在/);
});

test('accepts executable REG references defined in the regression corpus', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: ['## 能力清单', '| `ACCOUNT-01` | first |', '## 四站能力矩阵'].join('\n'),
    regressionCorpus: regressionEntry('REG-ACCOUNT-001'),
    source: "export const regression = 'REG-ACCOUNT-001';\n"
  });

  assert.deepEqual(findKnowledgeContractErrors(rootDir), []);
});

test('reports executable REG references missing from the regression corpus', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: ['## 能力清单', '| `ACCOUNT-01` | first |', '## 四站能力矩阵'].join('\n'),
    regressionCorpus: regressionEntry('REG-ACCOUNT-001'),
    source: "export const regression = 'REG-ACCOUNT-001';\n"
  });
  await mkdir(path.join(rootDir, 'tests'));
  await writeFile(
    path.join(rootDir, 'tests', 'regression.test.ts'),
    "test('[REG-ACCOUNT-999] unknown regression', () => {});\n"
  );

  const errors = findKnowledgeContractErrors(rootDir);

  assert.match(errors.join('\n'), /tests\/regression\.test\.ts:1.*REG-ACCOUNT-999.*不存在/);
  assert.match(errors.join('\n'), /tests\/regression\.test\.ts:1.*通过测试标题不得包含 REG/);
});

test('does not validate a local historical baseline as current documentation', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: ['## 能力清单', '| `ACCOUNT-01` | first |', '## 四站能力矩阵'].join('\n'),
    regressionCorpus: regressionEntry('REG-ACCOUNT-001'),
    markdown: '`ACCOUNT-01` `REG-ACCOUNT-001` `npm run verify`\n',
    packageScripts: { verify: 'echo ok' }
  });
  await writeFile(
    path.join(rootDir, 'docs', 'emulator-baseline.md'),
    '`ACCOUNT-99` `REG-ACCOUNT-999` `npm run removed-script` `src/removed.ts`\n'
  );

  assert.deepEqual(findKnowledgeContractErrors(rootDir, ['docs/guide.md']), []);
});

test('does not parse a REG id as a product capability id', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: ['## 能力清单', '| `FEED-01` | first |', '## 四站能力矩阵'].join('\n'),
    regressionCorpus: `${regressionEntry('REG-FEED-001', 'FEED-01')}Protects \`FEED-01\`.\n`
  });

  assert.deepEqual(findKnowledgeContractErrors(rootDir), []);
});

test('requires every expected failing UI test to name its regression id', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: ['## 能力清单', '| `TOPIC-03` | first |', '## 四站能力矩阵'].join('\n'),
    regressionCorpus: regressionEntry('REG-TOPIC-001', 'TOPIC-03', 'OPEN'),
    expectedFailure: "it.failing('shows the correct reply count', () => {});\n"
  });

  assert.match(
    findKnowledgeContractErrors(rootDir).join('\n'),
    /known-failure\.test\.tsx:1.*必须且只能引用一个 canonical REG ID/
  );
});

test('rejects an expected failing UI test that names an unknown regression', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: ['## 能力清单', '| `TOPIC-03` | first |', '## 四站能力矩阵'].join('\n'),
    regressionCorpus: regressionEntry('REG-TOPIC-001', 'TOPIC-03', 'OPEN'),
    expectedFailure: "it.failing('[REG-TOPIC-999] shows the correct reply count', () => {});\n"
  });

  assert.match(findKnowledgeContractErrors(rootDir).join('\n'), /REG-TOPIC-999.*不存在/);
});

test('rejects dynamic or parameterized expected-failure titles that bypass REG mapping', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: ['## 能力清单', '| `TOPIC-03` | first |', '## 四站能力矩阵'].join('\n'),
    regressionCorpus: regressionEntry('REG-TOPIC-001', 'TOPIC-03', 'OPEN'),
    expectedFailure: [
      "const title = '[REG-TOPIC-001] dynamic';",
      'it.failing(title, () => {});',
      'test.failing(`[REG-TOPIC-001] template`, () => {});',
      "it.failing.each([[1]])('[REG-TOPIC-001] case %s', () => {});"
    ].join('\n')
  });

  const errors = findKnowledgeContractErrors(rootDir).join('\n');
  assert.match(errors, /known-failure\.test\.tsx:2.*静态字符串标题/);
  assert.match(errors, /known-failure\.test\.tsx:3.*静态字符串标题/);
  assert.match(errors, /known-failure\.test\.tsx:4.*不支持 \.failing\.each/);
});

test('rejects REG ids in passing test titles', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: ['## 能力清单', '| `TOPIC-03` | first |', '## 四站能力矩阵'].join('\n'),
    regressionCorpus: regressionEntry('REG-TOPIC-001', 'TOPIC-03'),
    expectedFailure: "it('[REG-A11Y-001] shows the current behavior', () => {});\n"
  });

  assert.match(findKnowledgeContractErrors(rootDir).join('\n'), /通过测试标题不得包含 REG/);
});

test('parses TypeScript test files with their real script kind before checking titles', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: ['## 能力清单', '| `TOPIC-03` | first |', '## 四站能力矩阵'].join('\n'),
    regressionCorpus: regressionEntry('REG-TOPIC-001', 'TOPIC-03')
  });
  await writeFile(
    path.join(rootDir, 'src', 'generic.test.ts'),
    "const identity = <T>(value: T) => value;\nit('[REG-TOPIC-001] keeps identity', () => identity(1));\n"
  );

  assert.match(findKnowledgeContractErrors(rootDir).join('\n'), /generic\.test\.ts:2.*通过测试标题不得包含 REG/);
});

test('allows expected failures only for one open regression', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: ['## 能力清单', '| `TOPIC-03` | first |', '## 四站能力矩阵'].join('\n'),
    regressionCorpus: regressionEntry('REG-TOPIC-001', 'TOPIC-03'),
    expectedFailure: "it.failing('[REG-TOPIC-001] shows the correct reply count', () => {});\n"
  });

  assert.match(findKnowledgeContractErrors(rootDir).join('\n'), /REG-TOPIC-001.*状态不是 OPEN/);
});

test('requires legal status, capability, and current owner on every regression entry', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: ['## 能力清单', '| `ACCOUNT-01` | first |', '## 四站能力矩阵'].join('\n'),
    regressionCorpus:
      [
        '## `REG-ACCOUNT-001` malformed',
        '',
        '| 字段 | 内容 |',
        '| --- | --- |',
        '| 状态 | `FIXED` |',
        '| 能力 ID | `ACCOUNT-01` |',
        '| 历史事故 | symptom and seam |'
      ].join('\n') +
      '\n\n' +
      regressionEntry('REG-ACCOUNT-002', 'ACCOUNT-01', 'OPEN / FIXED')
  });

  const errors = findKnowledgeContractErrors(rootDir).join('\n');
  assert.match(errors, /REG-ACCOUNT-001.*状态/);
  assert.match(errors, /REG-ACCOUNT-001.*历史症状与根因/);
  assert.match(errors, /REG-ACCOUNT-001.*当前 owner/);
  assert.match(errors, /REG-ACCOUNT-002.*状态/);
});

test('allows multiple historical regressions to share one canonical owner', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: ['## 能力清单', '| `ACCOUNT-01` | first |', '## 四站能力矩阵'].join('\n'),
    regressionCorpus:
      regressionEntry('REG-ACCOUNT-001', 'ACCOUNT-01') + regressionEntry('REG-ACCOUNT-002', 'ACCOUNT-01')
  });

  assert.deepEqual(findKnowledgeContractErrors(rootDir), []);
});

test('reports retired user-facing authentication terms in source files', async () => {
  const rootDir = await createKnowledgeFixture({
    productMap: ['## 能力清单', '| `ACCOUNT-01` | first |', '## 四站能力矩阵'].join('\n'),
    source: "export const label = '身份识别保护';\n"
  });

  assert.match(findKnowledgeContractErrors(rootDir).join('\n'), /src\/screen\.tsx:1.*身份识别保护/);
});
