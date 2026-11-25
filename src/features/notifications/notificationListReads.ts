import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import { notificationPageCursor, type NotificationPageParam } from './notificationPagination';

export type NotificationListReadFilter = {
  source: 'all' | NotificationSource;
  categoryId: string;
  unreadOnly: boolean;
  queryKey: readonly unknown[];
};

export type NotificationSourceAuthority = {
  identityKey: string;
  sessionEpoch: number;
};

export type NotificationSourceRetryPosition = {
  seq: number;
  pageIndex: number;
  cursor: string | undefined;
};

export type NotificationListReadTicket = Readonly<{
  seq: number;
  scopeEpoch: number;
  mode: 'full-chain' | 'pagination' | 'source-retry';
  signal: AbortSignal;
  filter: NotificationListReadFilter;
  requestedSources: readonly NotificationSource[];
  sourceAuthorities: Readonly<Partial<Record<NotificationSource, NotificationSourceAuthority>>>;
  cursor: NotificationPageParam | string | null | undefined;
}>;

export type NotificationListScopeAccess = {
  focused: boolean;
  appFocused: boolean;
  ready: boolean;
  queryKey: readonly unknown[] | null;
};

export type NotificationSourceAccessCheck = NotificationListScopeAccess & {
  enabled: boolean;
  active: boolean;
  identityKey: string | undefined;
  sessionEpoch: number;
};

type SourceTrack = {
  bindingKey: string;
  latestReadSeq: number;
  latestReadByCursor: Map<string | undefined, number>;
  latestFullChainSeq: number;
  retryPositions: Map<string | undefined, NotificationSourceRetryPosition>;
  retries: Map<string | undefined, { seq: number; controller: AbortController }>;
};

function readCursor(
  cursor: NotificationListReadTicket['cursor'],
  filter: NotificationListReadFilter,
  source: NotificationSource
) {
  return (
    (typeof cursor === 'object' && cursor !== null ? notificationPageCursor(cursor, filter.source, source) : cursor) ||
    undefined
  );
}

function abortRetries(track: SourceTrack) {
  for (const retry of track.retries.values()) retry.controller.abort();
  track.retries.clear();
}

function sourceBindingKey(
  scopeEpoch: number,
  source: NotificationSource,
  authority: NotificationSourceAuthority,
  filter: NotificationListReadFilter
) {
  return JSON.stringify([
    scopeEpoch,
    source,
    authority.identityKey,
    authority.sessionEpoch,
    filter.source,
    filter.categoryId,
    filter.unreadOnly,
    filter.queryKey
  ]);
}

export function createNotificationListReads() {
  let refresh: object | null = null;
  const refreshListeners = new Set<() => void>();
  let nextSeq = 0;
  let scopeEpoch = 0;
  const tracks = new Map<NotificationSource, SourceTrack>();
  const queryOperations = new WeakMap<
    AbortSignal,
    {
      seq: number;
      scopeEpoch: number;
      sites: Map<NotificationSource, { authority: NotificationSourceAuthority; track: SourceTrack }>;
    }
  >();
  const setRefresh = (request: object | null) => {
    if (refresh === request) return;
    refresh = request;
    for (const listener of refreshListeners) listener();
  };
  const isScopeCurrent = (ticket: NotificationListReadTicket, access: NotificationListScopeAccess) =>
    !ticket.signal.aborted &&
    ticket.scopeEpoch === scopeEpoch &&
    access.focused &&
    access.appFocused &&
    access.ready &&
    access.queryKey === ticket.filter.queryKey;

  const trackFor = (source: NotificationSource, bindingKey: string): SourceTrack => {
    const existing = tracks.get(source);
    if (existing?.bindingKey === bindingKey) return existing;
    if (existing) abortRetries(existing);
    const created: SourceTrack = {
      bindingKey,
      latestReadSeq: 0,
      latestReadByCursor: new Map(),
      latestFullChainSeq: 0,
      retryPositions: new Map(),
      retries: new Map()
    };
    tracks.set(source, created);
    return created;
  };

  return {
    getRefreshing() {
      return refresh !== null;
    },
    subscribeRefresh(listener: () => void) {
      refreshListeners.add(listener);
      return () => {
        refreshListeners.delete(listener);
      };
    },
    get currentSeq() {
      return nextSeq;
    },
    beginRefresh() {
      if (refresh) return null;
      const request = {};
      setRefresh(request);
      return request;
    },
    finishRefresh(request: object) {
      if (refresh === request) setRefresh(null);
    },
    beginQueryRead(params: {
      mode: 'full-chain' | 'pagination';
      signal: AbortSignal;
      filter: NotificationListReadFilter;
      requestedSources: readonly NotificationSource[];
      sourceAuthorities: Partial<Record<NotificationSource, NotificationSourceAuthority>>;
      cursor: NotificationPageParam | string | null | undefined;
    }): NotificationListReadTicket {
      let operation = queryOperations.get(params.signal);
      if (!operation) {
        operation = { seq: ++nextSeq, scopeEpoch, sites: new Map() };
        queryOperations.set(params.signal, operation);
      }
      const { seq, scopeEpoch: startedScope } = operation;
      const requestedSources = [...params.requestedSources];
      const sourceAuthorities: Partial<Record<NotificationSource, NotificationSourceAuthority>> = {};
      for (const candidate of requestedSources) {
        const authority = params.sourceAuthorities[candidate];
        if (!authority) continue;
        const started = operation.sites.get(candidate);
        sourceAuthorities[candidate] = started?.authority ?? { ...authority };
        if (startedScope !== scopeEpoch || params.signal.aborted) continue;
        const bindingKey = sourceBindingKey(startedScope, candidate, authority, params.filter);
        const track = started?.track ?? trackFor(candidate, bindingKey);
        if (track.bindingKey !== bindingKey || tracks.get(candidate) !== track) continue;
        if (!started) operation.sites.set(candidate, { authority: sourceAuthorities[candidate]!, track });
        const cursor = readCursor(params.cursor, params.filter, candidate);
        track.latestReadSeq = Math.max(track.latestReadSeq, seq);
        track.latestReadByCursor.set(cursor, Math.max(track.latestReadByCursor.get(cursor) ?? 0, seq));
        if (params.mode === 'full-chain') {
          track.latestFullChainSeq = Math.max(track.latestFullChainSeq, seq);
        }
        for (const [retryCursor, retry] of track.retries) {
          if (retry.seq >= seq || (params.mode !== 'full-chain' && retryCursor !== cursor)) continue;
          retry.controller.abort();
          track.retries.delete(retryCursor);
        }
      }
      return {
        seq,
        scopeEpoch: startedScope,
        mode: params.mode,
        signal: params.signal,
        filter: params.filter,
        requestedSources,
        sourceAuthorities,
        cursor: params.cursor
      };
    },
    beginSourceRetry(params: {
      source: NotificationSource;
      authority: NotificationSourceAuthority;
      filter: NotificationListReadFilter;
      pageIndex: number;
      cursor: string | null | undefined;
    }): NotificationListReadTicket {
      const seq = ++nextSeq;
      const authority = { ...params.authority };
      const bindingKey = sourceBindingKey(scopeEpoch, params.source, authority, params.filter);
      const track = trackFor(params.source, bindingKey);
      const cursor = params.cursor || undefined;
      track.retries.get(cursor)?.controller.abort();
      const controller = new AbortController();
      track.latestReadSeq = seq;
      track.latestReadByCursor.set(cursor, seq);
      track.retryPositions.set(cursor, { seq, pageIndex: params.pageIndex, cursor });
      track.retries.set(cursor, { seq, controller });
      return {
        seq,
        scopeEpoch,
        mode: 'source-retry',
        signal: controller.signal,
        filter: params.filter,
        requestedSources: [params.source],
        sourceAuthorities: { [params.source]: authority },
        cursor: params.cursor
      };
    },
    isScopeCurrent,
    ownsSourceRead(
      ticket: NotificationListReadTicket,
      candidate: NotificationSource,
      access: NotificationSourceAccessCheck
    ) {
      if (!isScopeCurrent(ticket, access) || !ticket.requestedSources.includes(candidate)) return false;
      const authority = ticket.sourceAuthorities[candidate];
      if (
        !authority ||
        !access.enabled ||
        !access.active ||
        access.identityKey !== authority.identityKey ||
        access.sessionEpoch !== authority.sessionEpoch
      ) {
        return false;
      }
      const track = tracks.get(candidate);
      const bindingKey = sourceBindingKey(ticket.scopeEpoch, candidate, authority, ticket.filter);
      if (!track || track.bindingKey !== bindingKey) return false;
      const cursor = readCursor(ticket.cursor, ticket.filter, candidate);
      if (ticket.seq < (track.latestReadByCursor.get(cursor) ?? 0) || ticket.seq < track.latestFullChainSeq) {
        return false;
      }
      if (ticket.mode === 'source-retry') {
        const retry = track.retries.get(cursor);
        if (!retry || retry.seq !== ticket.seq || retry.controller.signal !== ticket.signal) {
          return false;
        }
      }
      return true;
    },
    newerSourceRetry(ticket: NotificationListReadTicket, candidate: NotificationSource) {
      const authority = ticket.sourceAuthorities[candidate];
      const track = tracks.get(candidate);
      if (
        !authority ||
        track?.bindingKey !== sourceBindingKey(ticket.scopeEpoch, candidate, authority, ticket.filter)
      ) {
        return undefined;
      }
      let earliest: NotificationSourceRetryPosition | undefined;
      for (const retry of track.retryPositions.values()) {
        if (retry.seq > ticket.seq && (!earliest || retry.pageIndex < earliest.pageIndex)) earliest = retry;
      }
      return earliest;
    },
    sourceReadSeq(
      candidate: NotificationSource,
      authority: NotificationSourceAuthority,
      filter: NotificationListReadFilter
    ) {
      const track = tracks.get(candidate);
      if (!track) return 0;
      const bindingKey = sourceBindingKey(scopeEpoch, candidate, authority, filter);
      return track.bindingKey === bindingKey ? track.latestReadSeq : 0;
    },
    finishSourceRetry(ticket: NotificationListReadTicket, disposition: 'completed' | 'aborted' = 'completed') {
      if (ticket.mode !== 'source-retry') return;
      const candidate = ticket.requestedSources[0];
      if (!candidate) return;
      const track = tracks.get(candidate);
      const cursor = readCursor(ticket.cursor, ticket.filter, candidate);
      const retry = track?.retries.get(cursor);
      if (track && retry?.controller.signal === ticket.signal) {
        track.retries.delete(cursor);
        if (disposition === 'aborted') retry.controller.abort();
      }
    },
    invalidateSource(source: NotificationSource) {
      const track = tracks.get(source);
      if (!track) return;
      abortRetries(track);
      tracks.delete(source);
    },
    invalidateScope() {
      scopeEpoch += 1;
      for (const track of tracks.values()) abortRetries(track);
      tracks.clear();
      setRefresh(null);
    }
  };
}
