import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import type { ConfigT } from '@expo/metro/metro-config';
import type { transform } from '@expo/metro-config/build/transform-worker/metro-transform-worker';
import type { NotificationAdapterAccess } from '@/sources/notificationAdapter';
import type { NotificationWorkerDependencies } from '@/platform/notifications/notificationWorker';

const nativeRequire = createRequire(import.meta.url);
const { getDefaultConfig } = nativeRequire('expo/metro-config');
const worker = nativeRequire('@expo/metro-config/build/transform-worker/metro-transform-worker');
const { getTransformFn } = nativeRequire('@expo/metro/metro/lib/transformHelpers');
const root = path.resolve(__dirname, '../..');
const defaults: ConfigT = getDefaultConfig(root);
const candidate: ConfigT = nativeRequire('../../scripts/startup-inline-requires.metro.cjs');
type Transformed = Awaited<ReturnType<typeof transform>>;
type ModuleExports = Record<string, unknown>;

async function productionTransform(config: ConfigT, files: string[]) {
  // Let Metro resolve its blockList and ignored imports, then execute Expo's installed production worker.
  const transformFile: (filename: string) => Promise<Transformed> = await getTransformFn(
    [path.join(root, 'index.ts')],
    {
      transformFile: (filename: string, options: Parameters<typeof transform>[4]) =>
        worker.transform(config.transformer, root, path.relative(root, filename), readFileSync(filename), options)
    },
    {},
    config,
    { dev: false, minify: true, platform: 'android', type: 'module', unstable_transformProfile: 'hermes-stable' },
    {}
  );
  return new Map(
    await Promise.all(
      files.map(async (file): Promise<[string, Transformed]> => [file, await transformFile(path.join(root, file))])
    )
  );
}

function evaluate(result: Transformed, load: (name: string) => ModuleExports) {
  const module: { exports: ModuleExports } = { exports: {} };
  const requireDependency = (index: number) => {
    const dependency = result.dependencies[index];
    if (!dependency) throw new Error(`Unknown Metro dependency ${index}`);
    return load(dependency.name);
  };
  runInNewContext(result.output[0].data.code, {
    __d(factory: (...args: unknown[]) => void) {
      factory(
        {},
        requireDependency,
        (index: number) => {
          const value = requireDependency(index);
          return value.__esModule ? value.default : value;
        },
        requireDependency,
        module,
        module.exports,
        result.dependencies.map((_, index) => index)
      );
    }
  });
  return module.exports;
}

describe('experimental startup inline requires', () => {
  it('preserves Expo transform options and keeps the bootstrap files eager', async () => {
    const baseline = await defaults.transformer.getTransformOptions(
      [],
      { dev: false, hot: true, platform: 'android' },
      async () => []
    );
    const proposed = await candidate.transformer.getTransformOptions(
      [],
      { dev: false, hot: true, platform: 'android' },
      async () => []
    );
    expect({ ...proposed, transform: { ...proposed.transform, inlineRequires: false } }).toEqual(baseline);
    expect(proposed.transform?.inlineRequires).toEqual({
      blockList: Object.fromEntries(
        ['index.ts', 'App.tsx', 'src/app/AppRoot.tsx', 'src/app/AppComposition.tsx'].map((file) => [
          path.join(root, file),
          true
        ])
      )
    });
  });

  it('registers the background task immediately but evaluates worker dependencies only when it runs', async () => {
    const filename = 'src/app/notificationBackgroundTask.ts';
    const deferred = [
      '@/sources/notificationAdapters',
      '@/platform/notifications/notificationWorker',
      '@/platform/storage/readerDataStore',
      '@/platform/network/networkProxy'
    ];
    for (const config of [defaults, candidate]) {
      const modules = await productionTransform(config, [filename]);
      const loads = new Set<string>();
      let task: (() => Promise<unknown>) | undefined;
      const settings = { contentSources: { nodeseek: true } };
      const access = { identityKey: 'nodeseek:7', userId: '7' };
      const listPage = vi.fn(async () => ({ quality: 'complete', items: [], cursor: null, hasMore: false }));
      const applyProxy = vi.fn(async () => {});
      const probeAccess = vi.fn(async () => access);
      const clear = vi.fn();
      const loadState = vi.fn();
      const record = vi.fn();
      const finish = vi.fn();
      const runWorker = vi.fn(async (dependencies: NotificationWorkerDependencies<NotificationAdapterAccess>) => {
        expect(dependencies.sources).toEqual(['nodeseek']);
        expect(await dependencies.sourceAllowed('nodeseek')).toBe(true);
        await dependencies.network.restoreProxy();
        expect(dependencies.network.probeAccess).toBe(probeAccess);
        await dependencies.network.listPage('nodeseek', access, new AbortController().signal, 'next');
        expect(dependencies.store).toEqual({ clearForContentDisable: clear, load: loadState, record });
        return { status: 'success', delivered: 0, failedSources: 0 };
      });
      const stubs: Record<string, ModuleExports> = {
        'expo-background-task': { BackgroundTaskResult: { Success: 'success', Failed: 'failed' } },
        'expo-task-manager': {
          isTaskDefined: () => false,
          defineTask: (_name: string, callback: typeof task) => {
            task = callback;
          }
        },
        '@/domain/reader/contentSourcePreferences': {
          projectContentSourcePreferences: () => ({ notificationSources: ['nodeseek'] })
        },
        '@/platform/storage/readerDataStore': { loadReaderSettings: vi.fn(async () => settings) },
        '@/platform/network/networkProxy': {
          loadNetworkProxyState: async () => ({ enabled: false }),
          applyNetworkProxy: applyProxy
        },
        '@/platform/notifications/notificationSystem': { NOTIFICATION_BACKGROUND_TASK: 'background' },
        '@/platform/notifications/notificationStore': {
          clearNotificationSourceForContentDisable: clear,
          loadNotificationState: loadState,
          recordNotificationDelivery: record
        },
        '@/platform/diagnostics/diagnostics': {
          beginDiagnosticTrace: () => ({}),
          markDiagnosticStage: vi.fn(),
          finishDiagnosticTrace: finish
        },
        '@/platform/diagnostics/diagnosticPolicy': { normalizeDiagnosticReason: () => 'unknown' },
        '@/sources/notificationBackgroundAccess': { probeBackgroundNotificationAccess: probeAccess },
        '@/sources/notificationAdapters': { notificationAdapters: { nodeseek: { listPage } } },
        '@/platform/notifications/notificationWorker': { runNotificationBackgroundWorker: runWorker }
      };
      evaluate(modules.get(filename)!, (name) => {
        loads.add(name);
        if (name.startsWith('@babel/runtime/')) return nativeRequire(name);
        if (!(name in stubs)) throw new Error(`Unexpected background dependency ${name}`);
        return stubs[name];
      });
      expect(task).toBeTypeOf('function');
      expect(deferred.filter((name) => loads.has(name))).toEqual(config === candidate ? [] : deferred);
      expect(await task!()).toBe('success');
      expect(runWorker).toHaveBeenCalledTimes(1);
      expect(applyProxy).toHaveBeenCalledExactlyOnceWith(null);
      expect(listPage).toHaveBeenCalledExactlyOnceWith({ ...access, cursor: 'next', limit: 60 });
      expect(finish).toHaveBeenCalledWith(expect.anything(), 'success', { delivered: 0, failedSources: 0 });
      expect(deferred.every((name) => loads.has(name))).toBe(true);
    }
  });

  it('keeps diagnostic, task, notification and root registration ordered and configures Splash before rendering', async () => {
    const files = [
      'index.ts',
      'App.tsx',
      'src/app/AppRoot.tsx',
      'src/app/AppComposition.tsx',
      'src/app/useAppStartupRuntime.ts',
      'src/app/notificationBackgroundTask.ts',
      'src/platform/diagnostics/diagnosticBootstrap.ts'
    ];
    for (const config of [defaults, candidate]) {
      const modules = await productionTransform(config, files);
      const events: string[] = [];
      const hide = vi.fn();
      const stubs: Record<string, ModuleExports> = {
        expo: { registerRootComponent: () => events.push('root') },
        'expo-task-manager': { isTaskDefined: () => false, defineTask: () => events.push('task') },
        'expo-splash-screen': {
          preventAutoHideAsync: () => {
            events.push('splash-prevent');
            return Promise.resolve();
          },
          setOptions: (options: object) => {
            expect(options).toEqual({ duration: 0, fade: false });
            events.push('splash-options');
          },
          hide
        },
        '@/platform/notifications/notificationSystem': {
          NOTIFICATION_BACKGROUND_TASK: 'background',
          installMessageNotificationHandler: () => events.push('handler')
        },
        './diagnosticFileStore': { initializeDiagnosticFileLogging: () => events.push('diagnostics') },
        './startupTiming': { setStartupTimingRecorder: vi.fn(), recordStartupPhase: vi.fn() },
        './nativeDiagnosticJournal': { nativeDiagnosticJournal: () => null }
      };
      const cache = new Map<string, ModuleExports>();
      const load = (name: string, owner = 'index.ts'): ModuleExports => {
        const relative = name.startsWith('@/')
          ? `src/${name.slice(2)}`
          : name.startsWith('.')
            ? path.posix.join(path.posix.dirname(owner), name)
            : name;
        const file = files.find((entry) => entry === `${relative}.ts` || entry === `${relative}.tsx`);
        if (file) {
          if (!cache.has(file))
            cache.set(
              file,
              evaluate(modules.get(file)!, (dependency) => load(dependency, file))
            );
          return cache.get(file)!;
        }
        if (name.startsWith('@babel/runtime/')) return nativeRequire(name);
        return stubs[name] || {};
      };
      load('./index');
      expect(events.filter((event) => !event.startsWith('splash-'))).toEqual([
        'diagnostics',
        'task',
        'handler',
        'root'
      ]);
      expect(events.filter((event) => event.startsWith('splash-'))).toEqual(['splash-prevent', 'splash-options']);
      expect(events.indexOf('splash-options')).toBeLessThan(events.indexOf('root'));
      expect(hide).not.toHaveBeenCalled();
    }
  });
});
