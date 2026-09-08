import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDiagnosticWriter } from './diagnostics';
import { installDiagnosticExceptionHandlers } from './diagnosticRuntime';

afterEach(() => setDiagnosticWriter(null));

describe('release exception diagnostics', () => {
  it('observes renderer exceptions once without suppressing RN handling or exposing private data', () => {
    const events: Record<string, unknown>[] = [];
    setDiagnosticWriter((line) => {
      events.push(JSON.parse(line));
    });
    let listener: ((exception: Record<string, unknown>) => void) | undefined;
    const register = vi.fn((callback) => {
      listener = callback;
    });
    const preventDefault = vi.fn();
    const legacy = { getGlobalHandler: vi.fn(), setGlobalHandler: vi.fn() };
    const runtime = {
      RN$registerExceptionListener: register,
      RN$useAlwaysAvailableJSErrorHandling: true,
      ErrorUtils: legacy
    };
    installDiagnosticExceptionHandlers(() => undefined, runtime);
    installDiagnosticExceptionHandlers(() => undefined, runtime);
    listener?.({
      name: 'TypeError',
      message: 'PRIVATE_SECRET',
      isFatal: true,
      preventDefault,
      stack: [
        { file: '/PRIVATE_PATH/index.android.bundle', methodName: 'PRIVATE_NAME', lineNumber: 1, column: 91827 },
        { file: 'InternalBytecode.js', methodName: 'PRIVATE_NAME', lineNumber: 1, column: 999 }
      ]
    });
    expect(register).toHaveBeenCalledTimes(1);
    expect(legacy.setGlobalHandler).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ operation: 'js-error', isFatal: true, stackFormat: 'rn-parsed' });
    expect(events[0].stack).toContain('[bundle]:1:91827');
    expect(JSON.stringify(events)).not.toMatch(/PRIVATE_|999/);
  });

  it('observes the legacy manager for direct renderer and ErrorUtils calls even when a native listener exists', () => {
    const events: Record<string, unknown>[] = [];
    setDiagnosticWriter((line) => {
      events.push(JSON.parse(line));
    });
    let listener: ((exception: Record<string, unknown>) => void) | undefined;
    const register = vi.fn((callback) => {
      listener = callback;
    });
    const original = vi.fn(function (this: unknown, ..._args: unknown[]) {
      listener?.({ name: 'Error', message: 'PRIVATE_NATIVE_DUPLICATE', isFatal: true, stack: [] });
      return this;
    });
    const manager = { handleException: original };
    const globalHandler = vi.fn((error, fatal) => manager.handleException(error, fatal));
    const runtime = {
      RN$registerExceptionListener: register,
      RN$useAlwaysAvailableJSErrorHandling: false,
      ErrorUtils: { getGlobalHandler: () => globalHandler, setGlobalHandler: vi.fn() }
    };
    const flush = vi.fn();
    installDiagnosticExceptionHandlers(flush, runtime, () => manager);
    const installed = manager.handleException;
    installDiagnosticExceptionHandlers(flush, runtime, () => manager);
    expect(manager.handleException).toBe(installed);
    expect(register).toHaveBeenCalledTimes(1);
    expect(runtime.ErrorUtils.setGlobalHandler).not.toHaveBeenCalled();
    const error = new Error('PRIVATE_RENDERER_MESSAGE');
    error.stack = 'Error\n    at renderer (address at /PRIVATE_BUNDLE:1:91827)';
    expect(manager.handleException(error, true, 'extra')).toBe(manager);
    globalHandler(error, false);
    expect(original.mock.calls).toEqual([
      [error, true, 'extra'],
      [error, false]
    ]);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.isFatal)).toEqual([true, false]);
    expect(events[0].stack).toContain('[bundle]:1:91827');
    expect(flush).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(events)).not.toContain('PRIVATE_');
    listener?.({ name: 'Error', message: 'PRIVATE_STANDALONE', isFatal: true, stack: [] });
    expect(events).toHaveLength(3);
  });

  it('falls back to ErrorUtils, delegates thrown errors, and does not duplicate a later manager hook', () => {
    const events: Record<string, unknown>[] = [];
    setDiagnosticWriter((line) => {
      events.push(JSON.parse(line));
    });
    const error = new Error('PRIVATE_THROWN');
    const original = vi.fn((_value: unknown, _fatal?: boolean) => {
      throw error;
    });
    const manager = { handleException: original };
    let globalHandler = (value: unknown, fatal?: boolean) => manager.handleException(value, fatal);
    const runtime = {
      RN$useAlwaysAvailableJSErrorHandling: false,
      ErrorUtils: {
        getGlobalHandler: () => globalHandler,
        setGlobalHandler: (handler: typeof globalHandler) => {
          globalHandler = handler;
        }
      }
    };
    installDiagnosticExceptionHandlers(
      () => undefined,
      runtime,
      () => undefined
    );
    const installed = globalHandler;
    installDiagnosticExceptionHandlers(
      () => undefined,
      runtime,
      () => undefined
    );
    expect(globalHandler).toBe(installed);
    installDiagnosticExceptionHandlers(
      () => undefined,
      runtime,
      () => manager
    );
    expect(() => globalHandler(error, true)).toThrow(error);
    expect(original).toHaveBeenCalledWith(error, true);
    expect(events).toHaveLength(1);
    expect(() => globalHandler(error, false)).toThrow(error);
    expect(events).toHaveLength(2);
  });

  it('tracks release Promise failures without replacing the development tracker', () => {
    const events: Record<string, unknown>[] = [];
    setDiagnosticWriter((line) => {
      events.push(JSON.parse(line));
    });
    const enable = vi.fn();
    installDiagnosticExceptionHandlers(() => undefined, {
      __DEV__: true,
      HermesInternal: { enablePromiseRejectionTracker: enable }
    });
    expect(enable).not.toHaveBeenCalled();
    installDiagnosticExceptionHandlers(() => undefined, {
      __DEV__: false,
      HermesInternal: { enablePromiseRejectionTracker: enable }
    });
    const options = enable.mock.calls[0][0];
    options.onUnhandled(1, new Error('PRIVATE_SECRET'));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ operation: 'unhandled-rejection', isFatal: false, outcome: 'failure' });
    expect(JSON.stringify(events)).not.toContain('PRIVATE_SECRET');
  });
});
