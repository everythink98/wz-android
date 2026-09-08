import { recordDiagnosticError } from './diagnostics';

type ErrorHandler = (error: unknown, isFatal?: boolean, ...additional: unknown[]) => unknown;
type ExceptionManager = { handleException: ErrorHandler };
type Runtime = {
  RN$registerExceptionListener?: (listener: (exception: Record<string, unknown>) => void) => void;
  RN$useAlwaysAvailableJSErrorHandling?: boolean;
  ErrorUtils?: { getGlobalHandler(): ErrorHandler; setGlobalHandler(handler: ErrorHandler): void };
  HermesInternal?: {
    enablePromiseRejectionTracker?: (options: {
      allRejections: boolean;
      onUnhandled(id: number, error: unknown): void;
      onHandled(id: number): void;
    }) => void;
  };
  __DEV__?: boolean;
};

const installedListeners = new WeakSet<NonNullable<Runtime['RN$registerExceptionListener']>>();
const installedHandlers = new WeakSet<ErrorHandler>();
let delegationDepth = 0;
const installedTrackers = new WeakSet<
  NonNullable<NonNullable<Runtime['HermesInternal']>['enablePromiseRejectionTracker']>
>();

function legacyExceptionManager(): ExceptionManager | undefined {
  try {
    // RN 0.86's legacy renderer calls this internal entry directly, bypassing ErrorUtils and C++ listeners.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('react-native/Libraries/Core/ExceptionsManager') as { default?: ExceptionManager };
    return typeof module.default?.handleException === 'function' ? module.default : undefined;
  } catch {
    return undefined;
  }
}

function observeHandler(original: ErrorHandler, flush: () => void): ErrorHandler {
  if (installedHandlers.has(original)) return original;
  const handler: ErrorHandler = function (this: unknown, ...args) {
    if (delegationDepth === 0) {
      try {
        recordDiagnosticError('app', 'js-error', args[0], { isFatal: args[1] === true });
        flush();
      } catch {
        /* Always delegate the original exception and arguments. */
      }
    }
    delegationDepth += 1;
    try {
      return original.apply(this, args);
    } finally {
      delegationDepth -= 1;
    }
  };
  installedHandlers.add(handler);
  return handler;
}

function processedException(exception: Record<string, unknown>) {
  const error = new Error(typeof exception.message === 'string' ? exception.message : '');
  error.name = typeof exception.name === 'string' ? exception.name : 'Error';
  const frames = Array.isArray(exception.stack) ? exception.stack : [];
  error.stack = [
    error.name,
    ...frames
      .flatMap((candidate: unknown) => {
        if (!candidate || typeof candidate !== 'object') return [];
        const frame = candidate as Record<string, unknown>;
        if (typeof frame.file !== 'string' || /InternalBytecode|\[native\]|native code/.test(frame.file)) return [];
        const line = frame.lineNumber;
        const column = frame.column;
        return typeof line === 'number' &&
          Number.isSafeInteger(line) &&
          line >= 0 &&
          line < 1_000_000_000 &&
          typeof column === 'number' &&
          Number.isSafeInteger(column) &&
          column >= 0 &&
          column < 1_000_000_000
          ? [`    at [frame] ([bundle]:${line}:${column})`]
          : [];
      })
      .slice(0, 24)
  ].join('\n');
  return error;
}

export function installDiagnosticExceptionHandlers(
  flush: () => void,
  runtime: Runtime = globalThis as Runtime,
  loadLegacyManager: () => ExceptionManager | undefined = legacyExceptionManager
) {
  try {
    const register = runtime.RN$registerExceptionListener;
    if (register) {
      if (!installedListeners.has(register)) {
        register((exception) => {
          if (delegationDepth > 0) return;
          try {
            recordDiagnosticError('app', 'js-error', processedException(exception), {
              isFatal: exception.isFatal === true,
              stackFormat: 'rn-parsed'
            });
            flush();
          } catch {
            /* Observers must never prevent the original exception handling. */
          }
        });
        installedListeners.add(register);
      }
    }
    if (runtime.RN$useAlwaysAvailableJSErrorHandling !== true || !register) {
      const manager = loadLegacyManager();
      if (manager) {
        manager.handleException = observeHandler(manager.handleException, flush);
      } else if (runtime.ErrorUtils) {
        const original = runtime.ErrorUtils.getGlobalHandler();
        if (typeof original === 'function' && !installedHandlers.has(original)) {
          runtime.ErrorUtils.setGlobalHandler(observeHandler(original, flush));
        }
      }
    }
    const tracker = runtime.HermesInternal?.enablePromiseRejectionTracker;
    // React Native already owns the development tracker; do not replace its LogBox behavior.
    if (runtime.__DEV__ !== true && tracker && !installedTrackers.has(tracker)) {
      tracker({
        allRejections: true,
        onUnhandled: (_id, error) => {
          try {
            recordDiagnosticError('app', 'unhandled-rejection', error, { isFatal: false });
            flush();
          } catch {
            /* Never reject from the rejection observer. */
          }
        },
        onHandled: () => undefined
      });
      installedTrackers.add(tracker);
    }
  } catch {
    /* Diagnostics cannot prevent startup when an engine hook is absent. */
  }
}
