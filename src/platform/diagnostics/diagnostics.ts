import {
  endpointClass,
  normalizeDiagnosticReason,
  safeByteCount,
  safeContentType,
  safeDiagnosticOperation,
  safeFields,
  safeMethod,
  sanitizeErrorStack,
  type DiagnosticArea,
  type DiagnosticEvent,
  type DiagnosticFetcher,
  type DiagnosticFields,
  type DiagnosticOutcome,
  type DiagnosticOperation,
  type DiagnosticPhase,
  type DiagnosticScalar,
  type DiagnosticTrace,
  type DiagnosticWriter
} from './diagnosticPolicy';

const appSessionId = `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const finishedTraces = new WeakSet<DiagnosticTrace>();

const outcomeHints = new WeakMap<
  DiagnosticTrace,
  {
    outcome: 'partial' | 'failure';
    fields: DiagnosticFields;
  }
>();

const DIAGNOSTIC_REQUEST = Symbol('wz.diagnosticRequest');

type DiagnosticRequestContext = { trace: DiagnosticTrace; requestId: string; active: boolean };
type DiagnosticRequestInit = RequestInit & { [DIAGNOSTIC_REQUEST]?: DiagnosticRequestContext };

let traceSequence = 0;
let requestSequence = 0;

let writer: DiagnosticWriter | null = null;

export function setDiagnosticWriter(nextWriter: DiagnosticWriter | null) {
  writer = nextWriter;
}

export function beginDiagnosticTrace(
  area: DiagnosticArea,
  operation: DiagnosticOperation,
  fields: DiagnosticFields = {},
  now = Date.now()
): DiagnosticTrace {
  const trace = createTrace(area, operation, now);
  emit(trace, 'intent', 'success', fields, now);
  return trace;
}

export function markDiagnosticStage(trace: DiagnosticTrace, phase: DiagnosticPhase, fields: DiagnosticFields = {}) {
  if (!finishedTraces.has(trace)) {
    emit(trace, phase, 'success', fields, Date.now());
  }
}

export function finishDiagnosticTrace(
  trace: DiagnosticTrace,
  outcome: DiagnosticOutcome,
  fields: DiagnosticFields = {},
  now = Date.now()
) {
  if (finishedTraces.has(trace)) {
    return;
  }
  finishedTraces.add(trace);
  const hint = outcomeHints.get(trace);
  outcomeHints.delete(trace);
  if (hint && (outcome === 'success' || outcome === 'noop' || outcome === 'partial')) {
    emit(
      trace,
      'finish',
      hint.outcome === 'failure' ? 'failure' : outcome === 'partial' ? 'partial' : hint.outcome,
      { ...fields, ...hint.fields },
      now
    );
    return;
  }
  emit(trace, 'finish', outcome, fields, now);
}

export function hintDiagnosticOutcome(
  trace: DiagnosticTrace,
  outcome: 'partial' | 'failure',
  fields: DiagnosticFields = {}
) {
  if (finishedTraces.has(trace)) {
    return;
  }
  const previous = outcomeHints.get(trace);
  if (!previous) {
    outcomeHints.set(trace, { outcome, fields: { ...fields } });
    return;
  }
  const nextIsAtLeastAsSevere = outcome === 'failure' || previous.outcome === 'partial';
  outcomeHints.set(
    trace,
    nextIsAtLeastAsSevere
      ? { outcome, fields: { ...previous.fields, ...fields } }
      : { outcome: previous.outcome, fields: { ...fields, ...previous.fields } }
  );
}

export function withDiagnosticFetcher(trace: DiagnosticTrace, fetcher: DiagnosticFetcher): DiagnosticFetcher {
  return async (input, init) => {
    const startedAt = Date.now();
    const parent = diagnosticRequestContext(init);
    const context = { trace, requestId: `request-${++requestSequence}`, active: true };
    const requestInit: DiagnosticRequestInit = { ...init, [DIAGNOSTIC_REQUEST]: context };
    const requestFields: DiagnosticFields = {
      requestId: context.requestId,
      ...(parent ? { parentRequestId: parent.requestId } : {}),
      endpoint: endpointClass(input, requestInit?.method),
      method: safeMethod(requestInit?.method)
    };
    emit(trace, 'transport', 'success', { ...requestFields, state: 'start' }, startedAt);
    try {
      const response = await fetcher(input, requestInit);
      const finishedAt = Date.now();
      const contentType = safeContentType(response.headers.get('content-type'));
      const byteCount = safeByteCount(response.headers.get('content-length'));
      emit(
        trace,
        'transport',
        response.ok ? 'success' : 'failure',
        {
          ...requestFields,
          state: 'finish',
          status: response.status,
          ...(contentType ? { contentType } : {}),
          ...(byteCount === undefined ? {} : { byteCount }),
          transportDurationMs: Math.max(0, finishedAt - startedAt)
        },
        finishedAt
      );
      return response;
    } catch (error) {
      const finishedAt = Date.now();
      const reason = normalizeDiagnosticReason(error);
      emit(
        trace,
        'transport',
        reason === 'canceled' ? 'canceled' : 'failure',
        {
          ...requestFields,
          state: 'failure',
          reason,
          transportDurationMs: Math.max(0, finishedAt - startedAt)
        },
        finishedAt
      );
      throw error;
    } finally {
      context.active = false;
    }
  };
}

export function diagnosticRequestContext(init?: RequestInit) {
  const context = (init as DiagnosticRequestInit | undefined)?.[DIAGNOSTIC_REQUEST];
  return context?.active ? context : undefined;
}

export function diagnosticTraceForRequest(init?: RequestInit) {
  return diagnosticRequestContext(init)?.trace;
}

export function diagnosticRequestFields(init?: RequestInit): Pick<DiagnosticFields, 'requestId'> {
  const context = diagnosticRequestContext(init);
  return context ? { requestId: context.requestId } : {};
}

export function withNativeDiagnosticRequest(init?: RequestInit): RequestInit | undefined {
  const context = diagnosticRequestContext(init);
  if (!context) return init;
  const headers = new Headers(init?.headers);
  headers.set('X-WZ-Diagnostic-Session', context.trace.appSessionId);
  headers.set('X-WZ-Diagnostic-Trace', context.trace.traceId);
  headers.set('X-WZ-Diagnostic-Request', context.requestId);
  return { ...init, headers };
}

export function recordDiagnosticError(
  area: DiagnosticArea,
  operation: DiagnosticOperation,
  error: unknown,
  context: DiagnosticFields = {}
) {
  const now = Date.now();
  const trace = createTrace(area, operation, now);
  const reason = normalizeDiagnosticReason(error);
  const fields: Record<string, DiagnosticScalar | undefined> = { ...context, reason };
  if (error instanceof Error) {
    fields.errorName = error.name;
    fields.message = reason;
    if (error.stack) {
      fields.stack = sanitizeErrorStack(error.stack, error.name);
      fields.stackFormat = context.stackFormat || (/\(address at /.test(error.stack) ? 'hermes' : 'source');
    }
  }
  finishedTraces.add(trace);
  emit(trace, 'finish', 'failure', fields, now);
}

function emit(
  trace: DiagnosticTrace,
  phase: DiagnosticPhase,
  outcome: DiagnosticOutcome,
  fields: Readonly<Record<string, unknown>>,
  now: number
) {
  if (!writer) {
    return;
  }
  const event: DiagnosticEvent = {
    schemaVersion: 1,
    time: new Date(now).toISOString(),
    appSessionId: trace.appSessionId,
    traceId: trace.traceId,
    area: trace.area,
    operation: trace.operation,
    phase,
    outcome,
    durationMs: Math.max(0, now - trace.startedAt),
    ...safeFields(fields)
  };
  try {
    void Promise.resolve(writer(`${JSON.stringify(event)}\n`)).catch(() => undefined);
  } catch {
    // Diagnostics must never change app behavior.
  }
}

export function createTrace(
  area: DiagnosticArea,
  operation: DiagnosticOperation,
  startedAt = Date.now()
): DiagnosticTrace {
  return {
    appSessionId,
    traceId: `trace-${++traceSequence}`,
    area,
    operation: safeDiagnosticOperation(operation),
    startedAt
  };
}
