import { useEffect, useState } from 'react';
import type { TopicCreationContext, TopicDraft, TopicTagSearchResult } from '@/domain/forum/topicComposer';
import { errorMessage } from '@/platform/network/errors';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

type TagSearchObservation =
  | { phase: 'empty' }
  | {
      phase: 'settled' | 'retry-requested';
      selection: string;
      scope: string;
      context: TopicCreationContext;
      result?: TopicTagSearchResult;
      error: string;
    };

export function useTopicTagSearch({
  context,
  draft,
  enabled,
  query,
  search
}: {
  context: TopicCreationContext | null;
  draft: TopicDraft | null;
  enabled: boolean;
  query: string;
  search: (query: string, signal: AbortSignal) => Promise<TopicTagSearchResult | undefined>;
}) {
  const scope = JSON.stringify([draft?.id, draft?.identityKey, draft?.categoryId, query]);
  const selection = JSON.stringify(draft?.source === 'linuxdo' ? draft.tags : []);
  const currentSelection = useCommittedRef(selection);
  const [state, setState] = useState<TagSearchObservation>({ phase: 'empty' });
  const current = state.phase !== 'empty' && state.context === context && state.scope === scope;
  const settled = current && state.phase === 'settled';
  useEffect(() => {
    if (!enabled || !draft?.categoryId || !context || settled) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      // Selection changes are local; only explicit searches refresh candidates and constraints.
      const selection = currentSelection.current;
      const finish = (result: TopicTagSearchResult | undefined, error = '') => {
        if (abort.signal.aborted) return;
        setState((previous) => ({
          selection,
          scope,
          context,
          phase: 'settled',
          error: error || (result ? '' : '标签读取失败，请重试'),
          result:
            result ||
            (previous.phase !== 'empty' && previous.scope === scope && previous.context === context
              ? previous.result
              : undefined)
        }));
      };
      void search(query, abort.signal).then(
        (result) => finish(result),
        (cause: unknown) => finish(undefined, errorMessage(cause))
      );
    }, 300);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [context, currentSelection, draft?.categoryId, enabled, query, scope, search, settled]);
  return {
    result: current ? state.result : undefined,
    rulesCurrent: Boolean(settled && !state.error && state.selection === selection),
    loading: !settled,
    error: settled ? state.error : '',
    retry: () => setState((current) => (current.phase === 'empty' ? current : { ...current, phase: 'retry-requested' }))
  };
}
