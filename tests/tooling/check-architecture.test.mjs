import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { analyzeArchitecture, ROOT_MODULES } from '../../scripts/check-architecture.mjs';

const temporaryRoots = [];

function architectureFixture(files, projectFiles = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'wz-architecture-'));
  temporaryRoots.push(root);
  const srcDir = path.join(root, 'src');
  for (const moduleName of ROOT_MODULES) mkdirSync(path.join(srcDir, moduleName), { recursive: true });
  for (const [relativeFile, source] of Object.entries(files)) {
    const filePath = path.join(srcDir, relativeFile);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, source);
  }
  for (const [relativeFile, source] of Object.entries(projectFiles)) {
    const filePath = path.join(root, relativeFile);
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

test('accepts the declarative app composition contract', () => {
  const srcDir = architectureFixture({
    'app/AppRoot.tsx': "import { AppComposition } from './AppComposition'; export const AppRoot = AppComposition;",
    'app/AppComposition.tsx':
      "import { AppRoutes } from './AppRoutes'; import { useAppRuntime } from './useAppRuntime'; export const AppComposition = () => useAppRuntime() && AppRoutes;",
    'app/AppRoutes.tsx':
      "import { AppNavigator } from './AppNavigator'; import { FeedRoute } from '@/features/feed/FeedRoute'; export const AppRoutes = [AppNavigator, FeedRoute];",
    'app/AppNavigator.tsx': "import { Nav } from '@/ui/Nav'; export const AppNavigator = Nav;",
    'app/useAppRuntime.ts':
      "import { useMemo } from 'react'; import type { FeedRouteRuntimeValue } from '@/features/feed/FeedRoute'; export const useAppRuntime = (): FeedRouteRuntimeValue => useMemo(() => true, []);",
    'features/feed/FeedRoute.tsx': 'export type FeedRouteRuntimeValue = boolean; export const FeedRoute = true;',
    'ui/Nav.ts': 'export const Nav = true;'
  });

  assert.deepEqual(analyzeArchitecture(srcDir).issues, []);
});

test('rejects state and fine-grained dependencies in the app composition chain', () => {
  const srcDir = architectureFixture({
    'app/AppRoot.tsx':
      "import { useState } from 'react'; import { FeedScreen } from '@/features/feed/FeedScreen'; export const AppRoot = () => useState(FeedScreen);",
    'app/AppComposition.tsx':
      "import { useTopicController } from '@/features/topic/useTopicController'; export const AppComposition = useTopicController;",
    'app/AppRoutes.tsx':
      "import { FeedScreen } from '@/features/feed/FeedScreen'; export const AppRoutes = FeedScreen;",
    'app/AppNavigator.tsx':
      "import { TopicRoute } from '@/features/topic/TopicRoute'; export const AppNavigator = TopicRoute;",
    'app/useAppRuntime.tsx':
      "import { useRef } from 'react'; import { FeedRoute } from '@/features/feed/FeedRoute'; import { FeedScreen } from '@/features/feed/FeedScreen'; export const useAppRuntime = () => useRef([FeedRoute, FeedScreen]);",
    'app/useAppTheme.ts':
      "import type { FeedRouteRuntimeValue } from '@/features/feed/FeedRoute'; export type Theme = FeedRouteRuntimeValue;",
    'features/feed/FeedScreen.tsx': 'export const FeedScreen = true;',
    'features/topic/TopicRoute.tsx': 'export const TopicRoute = true;',
    'features/topic/useTopicController.ts': 'export const useTopicController = true;'
  });
  const codes = analyzeArchitecture(srcDir).issues.map((issue) => issue.code);

  assert.ok(codes.includes('app-root-state-hook'));
  assert.ok(codes.includes('app-root-import'));
  assert.ok(codes.includes('app-composition-import'));
  assert.ok(codes.includes('app-routes-import'));
  assert.ok(codes.includes('app-navigator-feature'));
  assert.ok(codes.includes('app-runtime-state-hook'));
  assert.ok(codes.includes('app-runtime-route-value-import'));
  assert.ok(codes.includes('app-runtime-presentation-import'));
  assert.ok(codes.includes('app-theme-feature-import'));
});

test('rejects Screen props projection and raw account session escape', () => {
  const srcDir = architectureFixture({
    'features/more/MoreScreen.tsx': 'export const MoreScreen = () => null;',
    'features/more/MoreRoute.tsx':
      "import type { ComponentProps } from 'react'; import { MoreScreen } from './MoreScreen'; export type MoreRouteRuntimeValue = ComponentProps<typeof MoreScreen>;",
    'app/accountConsumer.ts': 'export const readSession = (accountRuntime: any) => accountRuntime.session;'
  });
  const codes = analyzeArchitecture(srcDir).issues.map((issue) => issue.code);

  assert.ok(codes.includes('route-runtime-screen-projection'));
  assert.ok(codes.includes('raw-account-session'));
});

test('keeps source-string contracts in tooling instead of behavior suites', () => {
  const sourceReader =
    "import { readFileSync } from 'node:fs'; export const source = readFileSync('src/app/AppRoot.tsx', 'utf8');";
  const srcDir = architectureFixture(
    {},
    {
      'tests/integration/source-contract.test.ts': sourceReader,
      'tests/tooling/release-contract.test.ts': sourceReader
    }
  );
  const issues = analyzeArchitecture(srcDir).issues.filter((issue) => issue.code === 'behavior-test-source-read');

  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /tests\/integration\/source-contract\.test\.ts/);
});

test('rejects legacy files and unresolved imports without compatibility shells', () => {
  const srcDir = architectureFixture({
    'app/useDeferredNavigationTask.ts': 'export const deferred = true;',
    'ui/theme/sharedStyles.ts': 'export const styles = true;',
    'features/topic/screenHelpers.ts': 'export const helper = true;',
    'features/search/controllerResults.ts': 'export const result = true;',
    'features/account/sessionControllerHelpers.ts': 'export const session = true;',
    'ui/components/AppControls.tsx': 'export const controls = true;',
    'features/feed/FeedRoute.tsx': "import { aggregate } from '@/sources/aggregateRead'; export const feed = aggregate;"
  });
  const legacyIssues = analyzeArchitecture(srcDir).issues.filter((issue) => issue.code === 'legacy-path');

  assert.equal(legacyIssues.length, 7);
});

test('rejects route entries that reach into another feature', () => {
  const srcDir = architectureFixture({
    'features/feed/FeedRoute.tsx':
      "import { SearchRoute } from '@/features/search/SearchRoute'; export const FeedRoute = SearchRoute;",
    'features/search/SearchRoute.tsx': 'export const SearchRoute = true;'
  });

  assert.equal(analyzeArchitecture(srcDir).issues.filter((issue) => issue.code === 'cross-feature').length, 1);
});
