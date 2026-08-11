import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Source } from '@/domain/forum/models';
import {
  cancelForumSourceQueries,
  removeUnconfirmedForumSourceQueries
} from '@/features/account/sessionQueryOwnership';

type ContentSourceQuerySnapshot = {
  enabledSources: readonly Source[];
  enabledSourcesKey: string;
};

export function cleanupContentSourceQueries(
  client: QueryClient,
  previous: ContentSourceQuerySnapshot,
  next: ContentSourceQuerySnapshot
) {
  if (previous.enabledSourcesKey === next.enabledSourcesKey) return;

  const nextSources = new Set(next.enabledSources);
  for (const source of previous.enabledSources) {
    if (nextSources.has(source)) continue;
    void cancelForumSourceQueries(source, client, false);
    removeUnconfirmedForumSourceQueries(source, client);
  }

  const previousAggregate = ({ queryKey }: { queryKey: readonly unknown[] }) => {
    const scope = queryKey[3];
    return (
      queryKey[0] === 'forum' &&
      queryKey[1] === 'all' &&
      (queryKey[2] === 'feed' || queryKey[2] === 'categories') &&
      typeof scope === 'object' &&
      scope !== null &&
      'enabledSources' in scope &&
      scope.enabledSources === previous.enabledSourcesKey
    );
  };
  void client.cancelQueries({ predicate: previousAggregate });
  client.removeQueries({ predicate: previousAggregate });
}

export function useContentSourceQueryCleanup(enabledSources: readonly Source[], enabledSourcesKey: string) {
  const client = useQueryClient();
  const previousRef = useRef<ContentSourceQuerySnapshot | null>(null);

  useEffect(() => {
    const next = { enabledSources, enabledSourcesKey };
    const previous = previousRef.current;
    previousRef.current = next;
    if (previous) cleanupContentSourceQueries(client, previous, next);
  }, [client, enabledSources, enabledSourcesKey]);
}
