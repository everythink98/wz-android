import type { Source, SourceErrors } from '@/domain/forum/models';
import { RequestCanceledError, REQUEST_CANCELED_MESSAGE, withAbortableTimeout } from '@/platform/network/request';
import { markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import { sourceDiagnosticSummary } from '@/platform/diagnostics/sourceDiagnosticSummary';
import { sourceErrorFromUnknown } from './sourceErrors';

export const AGGREGATE_SOURCE_BUDGET_MS = 5_000;
export const READ_PREPARATION_BUDGET_MS = 10_000;

export type ReadPreparation = {
  deadline: number;
  beforeRequest?: () => Promise<void>;
};

export async function readWithinAggregateSourceBudget<T>(
  source: Source,
  parentSignal: AbortSignal | undefined,
  read: (signal: AbortSignal) => Promise<T>,
  {
    prepare,
    preparation,
    trace
  }: {
    prepare?: (signal: AbortSignal) => Promise<unknown>;
    preparation?: ReadPreparation;
    trace?: DiagnosticTrace;
  } = {}
) {
  if (parentSignal?.aborted) {
    return Promise.reject(new Error(REQUEST_CANCELED_MESSAGE));
  }
  if (prepare || preparation?.beforeRequest) {
    const startedAt = Date.now();
    const remaining = (preparation?.deadline ?? startedAt + READ_PREPARATION_BUDGET_MS) - startedAt;
    const timeoutError = () =>
      Object.assign(new Error('读取准备超时，请重试'), { source, reason: 'preparation_timeout', retryable: true });
    if (trace) markDiagnosticStage(trace, 'guard', { source, state: 'pending', timeoutMs: Math.max(0, remaining) });
    try {
      if (remaining <= 0) throw timeoutError();
      await withAbortableTimeout(
        async (signal) => {
          if (signal.aborted) throw new RequestCanceledError();
          await preparation?.beforeRequest?.();
          if (signal.aborted) throw new RequestCanceledError();
          if (trace)
            markDiagnosticStage(trace, 'guard', { source, state: 'network-ready', latencyMs: Date.now() - startedAt });
          await prepare?.(signal);
          if (signal.aborted) throw new RequestCanceledError();
        },
        { signal: parentSignal, timeoutMs: remaining, timeoutError }
      );
      if (trace) markDiagnosticStage(trace, 'guard', { source, state: 'ready', latencyMs: Date.now() - startedAt });
    } catch (error) {
      if (trace)
        markDiagnosticStage(trace, 'guard', {
          source,
          state: 'failure',
          reason: normalizeDiagnosticReason(error),
          latencyMs: Date.now() - startedAt
        });
      throw error;
    }
  }
  if (parentSignal?.aborted) throw new RequestCanceledError();
  if (trace) markDiagnosticStage(trace, 'transport', { source, state: 'start', timeoutMs: AGGREGATE_SOURCE_BUDGET_MS });
  return withAbortableTimeout(
    (signal) => {
      if (signal.aborted) throw new RequestCanceledError();
      return read(signal);
    },
    {
      signal: parentSignal,
      timeoutMs: AGGREGATE_SOURCE_BUDGET_MS,
      canceledError: () => new Error(REQUEST_CANCELED_MESSAGE),
      timeoutError: () =>
        Object.assign(new Error(`${source} 聚合读取超过 5 秒`), { source, reason: 'aggregate_timeout' })
    }
  );
}

export function mergeSettledSourceErrors(
  results: PromiseSettledResult<{ errors?: SourceErrors }>[],
  sources: readonly Source[]
) {
  const errors: SourceErrors = {};
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') Object.assign(errors, result.value.errors || {});
    else errors[sources[index]] = sourceErrorFromUnknown(sources[index], result.reason);
  });
  return errors;
}

export function settledDiagnosticFacts(results: PromiseSettledResult<{ errors?: SourceErrors }>[]) {
  let droppedCount = 0;
  let partialErrorCount = 0;
  let missingFloorCount = 0;
  let hasRepeatedCursor = false;
  for (const result of results) {
    if (result.status === 'rejected') {
      partialErrorCount += 1;
      continue;
    }
    const summary = sourceDiagnosticSummary(result.value);
    droppedCount += summary?.droppedCount || 0;
    partialErrorCount += (summary?.partialErrorCount || 0) + Object.keys(result.value.errors || {}).length;
    missingFloorCount += summary?.missingFloorCount || 0;
    hasRepeatedCursor ||= summary?.hasRepeatedCursor === true;
  }
  return { droppedCount, partialErrorCount, missingFloorCount, hasRepeatedCursor };
}

export function dispatchSourceRead<T>(source: Source, handlers: Partial<Record<Source, () => Promise<T>>>): Promise<T> {
  const handler = handlers[source];
  if (!handler) throw new Error('来源不支持');
  return handler();
}

export function unavailableSourceRead(source: Source) {
  return Promise.reject(
    Object.assign(new Error(`${source} 凭据暂不可用`), {
      source,
      reason: 'credential_unavailable'
    })
  );
}
