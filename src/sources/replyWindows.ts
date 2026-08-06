import type { RepliesResponse, ReplyOrder } from '@/domain/forum/models';
import { annotateSourceDiagnosticSummary, copySourceDiagnosticSummary } from './diagnostics';

export function emptyReplyWindow(parserVariant: string): RepliesResponse {
  return annotateSourceDiagnosticSummary(
    {
      items: [],
      currentPage: 1,
      hasMore: false,
      nextPage: null,
      totalCount: 0
    },
    { parserVariant, candidateCount: 0, validCount: 0, droppedCount: 0, isExpectedEmpty: true }
  );
}

export function orientReplyWindow(result: RepliesResponse, order: ReplyOrder): RepliesResponse {
  if (order === 'oldest') return result;
  return copySourceDiagnosticSummary(
    {
      ...result,
      items: [...result.items].reverse(),
      previousPage: result.nextPage ?? null,
      previousOffset: result.nextOffset ?? null,
      hasMore: Boolean(result.previousPage),
      nextPage: result.previousPage ?? null,
      nextOffset: result.previousOffset ?? null
    },
    result
  );
}
