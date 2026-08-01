import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { analyzeArchitecture, ROOT_MODULES } from '../../scripts/check-architecture.mjs';

const temporaryRoots = [];

function architectureFixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'wz-architecture-'));
  temporaryRoots.push(root);
  const srcDir = path.join(root, 'src');
  for (const moduleName of ROOT_MODULES) mkdirSync(path.join(srcDir, moduleName), { recursive: true });
  for (const [relativeFile, source] of Object.entries(files)) {
    const filePath = path.join(srcDir, relativeFile);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, source);
  }
  return srcDir;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

test('accepts the dependency direction and same-feature imports', () => {
  const srcDir = architectureFixture({
    'domain/model.ts': 'export type Model = { id: string };',
    'platform/storage.ts': "import type { Model } from '@/domain/model'; export type Stored = Model;",
    'sources/discourse/client.ts': "import type { Stored } from '@/platform/storage'; export type Client = Stored;",
    'sources/linuxdo/reader.ts': "import type { Client } from '@/sources/discourse/client'; export type Read = Client;",
    'ui/card.ts': "import type { Model } from '@/domain/model'; export type Card = Model;",
    'features/feed/screen.ts':
      "import type { Read } from '@/sources/linuxdo/reader'; import type { Card } from '@/ui/card'; export type Feed = Read & Card;",
    'features/feed/controller.ts': "import type { Feed } from './screen'; export type Controller = Feed;",
    'app/root.ts': "import type { Controller } from '@/features/feed/controller'; export type Root = Controller;"
  });

  assert.deepEqual(analyzeArchitecture(srcDir).issues, []);
});

test('rejects reverse, cross-feature, and cross-provider imports', () => {
  const srcDir = architectureFixture({
    'platform/storage.ts': 'export const storage = true;',
    'domain/model.ts': "import { storage } from '@/platform/storage'; export const model = storage;",
    'features/search/controller.ts': 'export const search = true;',
    'features/feed/controller.ts': "import { search } from '@/features/search/controller'; export const feed = search;",
    'sources/nodeseek/reader.ts': 'export const read = true;',
    'sources/linuxdo/reader.ts': "import { read } from '@/sources/nodeseek/reader'; export { read };"
  });
  const codes = analyzeArchitecture(srcDir).issues.map((issue) => issue.code);

  assert.ok(codes.includes('dependency-direction'));
  assert.ok(codes.includes('cross-feature'));
  assert.ok(codes.includes('cross-provider'));
});

test('rejects invalid source roots and barrel files', () => {
  const srcDir = architectureFixture({
    'domain/index.ts': 'export const model = true;',
    'legacy/file.ts': 'export const legacy = true;',
    'root.ts': 'export const root = true;'
  });
  rmSync(path.join(srcDir, 'ui'), { recursive: true });
  const codes = analyzeArchitecture(srcDir).issues.map((issue) => issue.code);

  assert.ok(codes.includes('missing-root'));
  assert.ok(codes.includes('root-file'));
  assert.ok(codes.includes('unexpected-root'));
  assert.ok(codes.includes('barrel'));
});

test('enforces relative imports inside an owner and aliases across owners', () => {
  const srcDir = architectureFixture({
    'features/feed/screen.ts': 'export type Feed = { id: string };',
    'features/feed/controller.ts': "import type { Feed } from '@/features/feed/screen'; export type Controller = Feed;",
    'features/search/controller.ts': "import type { Feed } from '../feed/screen'; export type SearchController = Feed;"
  });

  assert.equal(analyzeArchitecture(srcDir).issues.filter((issue) => issue.code === 'import-style').length, 2);
});

test('detects dependency cycles', () => {
  const srcDir = architectureFixture({
    'domain/left.ts': "import type { Right } from './right'; export type Left = Right;",
    'domain/right.ts': "import type { Left } from './left'; export type Right = Left;"
  });

  assert.equal(analyzeArchitecture(srcDir).issues.filter((issue) => issue.code === 'cycle').length, 1);
});

test('resolves Metro platform files before generic modules', () => {
  const srcDir = architectureFixture({
    'domain/left.ts': "import type { Right } from './right'; export type Left = Right;",
    'domain/right.ts': 'export type Right = { id: string };',
    'domain/right.android.ts': "import type { Left } from './left'; export type Right = Left;"
  });

  assert.equal(analyzeArchitecture(srcDir).issues.filter((issue) => issue.code === 'cycle').length, 1);
});
