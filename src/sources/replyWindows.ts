import type { RepliesResponse, ReplyOrder } from '@/domain/forum/models';
import { copySourceDiagnosticSummary } from './diagnostics';

export function orientReplyWindow(result: RepliesResponse, order: ReplyOrder): RepliesResponse {
  if (order === 'oldest') return result;
  return reverseReplyWindow(result);
}

export function reverseReplyWindow<T extends RepliesResponse>(result: T): T {
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
  ) as T;
}
