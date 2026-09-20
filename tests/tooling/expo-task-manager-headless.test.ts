import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';

const { transformSync } = createRequire(import.meta.url)('@babel/core');
type TaskEvent = { executionInfo: { eventId: string; taskName: string }; data: null; error: null };

it.each(['src/TaskManager.ts', 'build/TaskManager.js'])(
  '%s leaves the headless lifetime with Expo while successful and failed task events settle',
  async (entry) => {
    // Execute the installed RN and Expo owners; only native bridges are replaced.
    const registry = {} as {
      startHeadlessTask: (id: number, name: string, data: object) => void;
    };
    const rnFinished = vi.fn();
    runInNewContext(
      transformSync(readFileSync('node_modules/react-native/Libraries/ReactNative/AppRegistryImpl.js', 'utf8'), {
        babelrc: false,
        configFile: false,
        plugins: ['@babel/plugin-transform-flow-strip-types', '@babel/plugin-transform-modules-commonjs']
      }).code,
      {
        exports: registry,
        console,
        require(name: string) {
          if (name === './NativeHeadlessJsTaskSupport') return { default: { notifyTaskFinished: rnFinished } };
          if (name === './HeadlessJsTaskError') return class HeadlessJsTaskError extends Error {};
          if (
            ['../Utilities/SceneTracker', './DeprecatedPerformanceLoggerStub', './DisplayMode', 'invariant'].includes(
              name
            )
          )
            return {};
          throw new Error(`Unexpected RN dependency ${name}`);
        }
      }
    );
    const manager = {} as { defineTask: (name: string, task: () => Promise<unknown>) => void };
    let onEvent!: (event: TaskEvent) => Promise<void>;
    const expoFinished = vi.fn(async () => {});
    const nativeManager = { EVENT_NAME: 'execute', notifyTaskFinishedAsync: expoFinished };
    runInNewContext(
      ts.transpileModule(readFileSync(`node_modules/expo-task-manager/${entry}`, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
      }).outputText,
      {
        exports: manager,
        console: { ...console, error: vi.fn() },
        require(name: string) {
          if (name === 'react-native') return { AppRegistry: registry };
          if (name === 'expo-modules-core')
            return {
              Platform: { OS: 'android' },
              LegacyEventEmitter: class {
                addListener(_name: string, callback: typeof onEvent) {
                  onEvent = callback;
                }
              },
              UnavailabilityError: Error
            };
          if (name === './ExpoTaskManager') return { __esModule: true, default: nativeManager };
          throw new Error(`Unexpected Expo dependency ${name}`);
        }
      }
    );
    const first = Promise.withResolvers<string>();
    const second = Promise.withResolvers<string>();
    manager.defineTask('first', () => first.promise);
    manager.defineTask('second', () => second.promise);
    registry.startHeadlessTask(1, 'expo-task-manager', {});
    const dispatch = (taskName: string) =>
      onEvent({ executionInfo: { eventId: taskName, taskName }, data: null, error: null });
    const pending = [dispatch('first'), dispatch('second')];
    await new Promise((resolve) => setImmediate(resolve));
    const prematurelyFinished = rnFinished.mock.calls.length;
    first.resolve('done');
    await pending[0];
    expect(expoFinished).toHaveBeenCalledExactlyOnceWith('first', { eventId: 'first', result: 'done' });
    second.reject(new Error('Controlled task failure'));
    await pending[1];
    expect(expoFinished).toHaveBeenCalledTimes(2);
    expect(expoFinished).toHaveBeenLastCalledWith('second', { eventId: 'second', result: null });
    expect(prematurelyFinished).toBe(0);
    expect(rnFinished).not.toHaveBeenCalled();
  }
);
