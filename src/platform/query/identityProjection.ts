import { isSessionSource, sessionSources } from '@/domain/forum/sourceCatalog';
import type { Source, SourceErrors } from '@/domain/forum/models';
import type { ForumIdentityBarrierSource } from './serverState';
import type { ForumSessionEpochs } from './sessionEpochs';

type AggregateQueryKeyState = {
  category?: unknown;
  feedFilter?: unknown;
  identityBarriers?: unknown;
  sessionEpoch?: unknown;
};

export function canRetainTrustedSource(
  source: Source,
  blockedSources: ReadonlySet<ForumIdentityBarrierSource>,
  retainableSources: ReadonlySet<ForumIdentityBarrierSource>
) {
  return !isSessionSource(source) || !blockedSources.has(source) || retainableSources.has(source);
}

export function normalizeIdentityBarriers(barriers: readonly ForumIdentityBarrierSource[]) {
  return [...new Set(barriers)].sort();
}

export function sameIdentityBarriers(
  left: readonly ForumIdentityBarrierSource[],
  right: readonly ForumIdentityBarrierSource[]
) {
  const normalizedRight = normalizeIdentityBarriers(right);
  return left.length === normalizedRight.length && left.every((source, index) => source === normalizedRight[index]);
}

export function sameSessionEpochs(left: ForumSessionEpochs, right: ForumSessionEpochs) {
  return sessionSources.every((source) => left[source] === right[source]);
}

export function changedSessionSources(left: ForumSessionEpochs, right: ForumSessionEpochs) {
  return new Set(sessionSources.filter((source) => left[source] !== right[source]));
}

export function identityBarriersOnlyRemoved(
  previous: readonly ForumIdentityBarrierSource[],
  current: readonly ForumIdentityBarrierSource[]
) {
  const normalizedCurrent = normalizeIdentityBarriers(current);
  return normalizedCurrent.length < previous.length && normalizedCurrent.every((source) => previous.includes(source));
}

function aggregateQueryKeyState(
  queryKey: readonly unknown[],
  resource: 'categories' | 'feed'
): AggregateQueryKeyState | null {
  if (
    queryKey[0] !== 'forum' ||
    queryKey[1] !== 'all' ||
    queryKey[2] !== resource ||
    !queryKey[3] ||
    typeof queryKey[3] !== 'object'
  ) {
    return null;
  }
  return queryKey[3] as AggregateQueryKeyState;
}

export function changedSourcesForIdentityTransition(
  previousQueryKey: readonly unknown[] | undefined,
  currentQueryKey: readonly unknown[],
  resource: 'categories' | 'feed',
  scopedFields: readonly (keyof AggregateQueryKeyState)[] = []
) {
  const previous = previousQueryKey ? aggregateQueryKeyState(previousQueryKey, resource) : null;
  const current = aggregateQueryKeyState(currentQueryKey, resource);
  if (!previous || !current || scopedFields.some((field) => !Object.is(previous[field], current[field]))) {
    return null;
  }

  const previousEpochs = previous.sessionEpoch as Partial<ForumSessionEpochs> | undefined;
  const currentEpochs = current.sessionEpoch as Partial<ForumSessionEpochs> | undefined;
  if (!previousEpochs || !currentEpochs) {
    return null;
  }
  return new Set(sessionSources.filter((source) => previousEpochs[source] !== currentEpochs[source]));
}

export function withoutChangedSourceErrors(
  errors: SourceErrors | undefined,
  changedSources: ReadonlySet<ForumIdentityBarrierSource>
) {
  return Object.fromEntries(
    Object.entries(errors || {}).filter(([source]) => !changedSources.has(source as ForumIdentityBarrierSource))
  ) as SourceErrors;
}

export function visibleIdentityErrors(
  errors: SourceErrors | undefined,
  blockedSources: ReadonlySet<ForumIdentityBarrierSource>,
  retainableSources: ReadonlySet<ForumIdentityBarrierSource>
) {
  const current = errors || {};
  const visible = Object.entries(current).filter(([source]) =>
    canRetainTrustedSource(source as Source, blockedSources, retainableSources)
  );
  return visible.length === Object.keys(current).length ? current : (Object.fromEntries(visible) as SourceErrors);
}
