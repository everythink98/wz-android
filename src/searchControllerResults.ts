import type { SearchGroup } from './searchListItems';
import type { FeedSource } from './types';

export type SearchHistoryWriteQueue = {
  current: Promise<void>;
};

export type RemoteSearchAction =
  | { type: 'yaohuo-login'; message: string }
  | { type: 'nodeseek-verification'; message: string };

export type RemoteSearchSourceResult =
  | { kind: 'success'; group: SearchGroup }
  | { kind: 'failed'; group: SearchGroup }
  | { kind: 'action-required'; group: SearchGroup; action: RemoteSearchAction };

export function groupFromRemoteSearchResult(result: RemoteSearchSourceResult) {
  return result.group;
}

export function firstRemoteSearchAction(results: RemoteSearchSourceResult[]) {
  return results.find((result) => result.kind === 'action-required')?.action;
}

export function remoteSearchActionForSource(source: FeedSource, results: RemoteSearchSourceResult[]) {
  return source === 'all' ? undefined : firstRemoteSearchAction(results);
}

export function createSearchHistoryWriteQueue(): SearchHistoryWriteQueue {
  return { current: Promise.resolve() };
}

export function enqueueSearchHistoryWrite(queue: SearchHistoryWriteQueue, task: () => Promise<void>) {
  const run = queue.current.catch(() => undefined).then(task);
  queue.current = run.then(() => undefined, () => undefined);
  return run;
}
