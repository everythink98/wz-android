import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';

it('continues syncing settled styles after nested animated hosts unregister the same native view', () => {
  const source = readFileSync('node_modules/react-native-reanimated/src/PropsRegistryGarbageCollector.ts', 'utf8');
  const exports: Record<string, unknown> = {};
  const timers = new Set<() => void>();
  const sync = vi.fn();
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
    require: (name: string) => {
      if (name === './ReanimatedModule') {
        return { ReanimatedModule: { getSettledUpdates: () => [{ viewTag: 2, styleProps: { height: 460 } }] } };
      }
      if (name === './common/style/processors/colors') {
        return { unprocessColorsInProps: () => {}, unprocessColor: (value: unknown) => value };
      }
      throw new Error(`Unexpected dependency: ${name}`);
    },
    setInterval: (tick: () => void) => {
      timers.add(tick);
      return tick;
    },
    clearInterval: (tick: () => void) => timers.delete(tick)
  });
  const collector = exports.PropsRegistryGarbageCollector as {
    registerView: (tag: number, component: { _syncStylePropsBackToReact: typeof sync }) => void;
    unregisterView: (tag: number) => void;
  };
  const component = { _syncStylePropsBackToReact: sync };
  collector.registerView(1, component);
  collector.registerView(1, component);
  collector.unregisterView(1);
  collector.unregisterView(1);
  expect(timers.size).toBe(0);
  collector.registerView(2, component);
  timers.forEach((tick) => tick());
  expect(sync).toHaveBeenCalledWith({ height: 460 });
  collector.unregisterView(2);
  expect(timers.size).toBe(0);
});
