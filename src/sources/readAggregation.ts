import type { Source, SourceErrors } from '@/domain/forum/models';
import { sourceDiagnosticSummary } from './diagnostics';
import { sourceErrorFromUnknown } from './sourceErrors';

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
