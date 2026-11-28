import type { NotificationMessage } from '@/domain/notifications/models';

type History = {
  sessionEpoch: number;
  messages: NotificationMessage[];
  olderCursor: string | null;
  consumedCursors: string[];
  blocked?: boolean;
  later?: { cursor: string | null; consumedCursors: string[]; blocked?: boolean };
};
type PageRequest = Readonly<{
  controller: AbortController;
  kind: 'earlier' | 'later';
  cursor: string;
  consumedCursors: readonly string[];
}>;
type Request = Readonly<{ controller: AbortController; kind: 'reset' }> | PageRequest;
type Work =
  { kind: 'idle' } | { kind: 'loading'; request: Request } | { kind: 'awaiting-commit'; request: PageRequest };
type Snapshot = Readonly<{ history: History | undefined; busy: boolean; error: string }>;

function uniqueMessages(messages: NotificationMessage[]) {
  return [...new Map(messages.map((message) => [message.id, message])).values()];
}

function initialHistory(
  sessionEpoch: number,
  messages: NotificationMessage[],
  olderCursor: string | null,
  newerCursor?: string | null
): History {
  return {
    sessionEpoch,
    messages,
    olderCursor,
    consumedCursors: [],
    ...(newerCursor !== undefined ? { later: { cursor: newerCursor, consumedCursors: [] } } : {})
  };
}

function mergeMessageWindow(
  current: History,
  start: number,
  messages: NotificationMessage[],
  olderCursor: string | null,
  newerCursor?: string | null
) {
  const end = newerCursor == null ? -1 : current.messages.findIndex((message) => message.id === messages.at(-1)?.id);
  const keepEarlier = start >= 0 && (newerCursor === undefined || olderCursor !== null);
  const keepLater = end >= 0;
  const ids = new Set(messages.map((message) => message.id));
  const earlier = keepEarlier ? current.messages.slice(0, start).filter((message) => !ids.has(message.id)) : [];
  const later = keepLater ? current.messages.slice(end + 1).filter((message) => !ids.has(message.id)) : [];
  return {
    ...initialHistory(
      current.sessionEpoch,
      uniqueMessages([...earlier, ...messages, ...later]),
      olderCursor,
      newerCursor
    ),
    ...(keepEarlier && current.consumedCursors.length
      ? { olderCursor: current.olderCursor, consumedCursors: current.consumedCursors, blocked: current.blocked }
      : {}),
    ...(keepLater && current.later?.consumedCursors.length ? { later: current.later } : {})
  };
}

export function createNotificationConversationHistory() {
  let history: History | undefined;
  let committed: History | undefined;
  let work: Work = { kind: 'idle' };
  let error = '';
  let snapshot: Snapshot = { history, busy: false, error };
  const owns = (controller: AbortController) =>
    work.kind !== 'idle' && work.request.controller === controller && !controller.signal.aborted;
  const cancel = () => {
    if (work.kind !== 'idle') work.request.controller.abort();
    work = { kind: 'idle' };
  };
  const beginPage = (sessionEpoch: number, kind: PageRequest['kind']) => {
    if (work.kind !== 'idle' || !committed || committed !== history || committed.sessionEpoch !== sessionEpoch)
      return null;
    const edge =
      kind === 'earlier'
        ? { cursor: committed.olderCursor, consumedCursors: committed.consumedCursors, blocked: committed.blocked }
        : committed.later;
    if (!edge?.cursor || edge.blocked) return null;
    const request = {
      controller: new AbortController(),
      kind,
      cursor: edge.cursor,
      consumedCursors: edge.consumedCursors
    };
    work = { kind: 'loading', request };
    error = '';
    return request;
  };
  const receivePage = (
    controller: AbortController,
    messages: NotificationMessage[],
    nextCursor: string | null,
    kind: PageRequest['kind']
  ) => {
    if (work.kind !== 'loading' || work.request.kind !== kind || !owns(controller) || !history || !committed) return;
    const request = work.request;
    const consumedCursors = [...request.consumedCursors, request.cursor];
    const repeated = nextCursor !== null && consumedCursors.includes(nextCursor);
    if (repeated) error = '原站历史游标重复，已停止加载。请重新读取会话后重试。';
    const cursor = repeated ? request.cursor : nextCursor;
    history =
      kind === 'earlier'
        ? {
            ...history,
            messages: uniqueMessages([...messages, ...history.messages]),
            olderCursor: cursor,
            blocked: repeated,
            consumedCursors
          }
        : {
            ...history,
            messages: uniqueMessages([...history.messages, ...messages]),
            later: { cursor, consumedCursors, blocked: repeated }
          };
    work = { kind: 'awaiting-commit', request };
  };
  return {
    owns,
    cancel,
    get committed() {
      return committed;
    },
    get pending() {
      return work.kind !== 'idle';
    },
    get snapshot() {
      const busy = work.kind !== 'idle';
      if (snapshot.history !== history || snapshot.busy !== busy || snapshot.error !== error)
        snapshot = { history, busy, error };
      return snapshot;
    },
    observedCommit(value: History | undefined) {
      committed = value;
      if (work.kind === 'awaiting-commit') {
        const cursors = work.request.kind === 'earlier' ? value?.consumedCursors : value?.later?.consumedCursors;
        if (cursors?.at(-1) === work.request.cursor) work = { kind: 'idle' };
      }
    },
    resetScope() {
      cancel();
      history = undefined;
      committed = undefined;
      error = '';
    },
    latest(
      sessionEpoch: number,
      messages: NotificationMessage[],
      olderCursor: string | null,
      newerCursor?: string | null
    ) {
      const current = history?.sessionEpoch === sessionEpoch ? history : undefined;
      const resetting = work.kind !== 'idle' && work.request.kind === 'reset';
      const start = current?.messages.findIndex((message) => message.id === messages[0]?.id) ?? -1;
      if (current && !resetting && (newerCursor === undefined ? start >= 0 : current.later)) {
        history = mergeMessageWindow(current, start, messages, olderCursor, newerCursor);
      } else {
        if (newerCursor === undefined && current?.messages.length && !resetting) {
          cancel();
          const ids = new Set(messages.map((message) => message.id));
          error = current.messages.some((message) => ids.has(message.id))
            ? '最新消息范围已变化，已重新从最新消息开始；可继续加载更早消息。'
            : '最新消息与已加载历史不连续，已重新从最新消息开始；可继续加载更早消息。';
        }
        history = initialHistory(sessionEpoch, messages, olderCursor, newerCursor);
      }
      if (work.kind !== 'idle' && work.request.kind !== 'reset') {
        const edge =
          work.request.kind === 'earlier'
            ? { cursor: history.olderCursor, consumedCursors: history.consumedCursors }
            : history.later;
        if (
          !current ||
          (work.kind === 'loading'
            ? edge?.cursor !== work.request.cursor
            : !edge?.consumedCursors.includes(work.request.cursor))
        )
          cancel();
      }
    },
    beginEarlier(sessionEpoch: number) {
      return beginPage(sessionEpoch, 'earlier');
    },
    beginLater(sessionEpoch: number) {
      return beginPage(sessionEpoch, 'later');
    },
    receivedEarlier(
      controller: AbortController,
      page: { messages: NotificationMessage[]; olderCursor: string | null }
    ) {
      receivePage(controller, page.messages, page.olderCursor, 'earlier');
    },
    receivedLater(controller: AbortController, page: { messages: NotificationMessage[]; newerCursor: string | null }) {
      receivePage(controller, page.messages, page.newerCursor, 'later');
    },
    beginReset() {
      if (work.kind !== 'idle') return null;
      const request = { controller: new AbortController(), kind: 'reset' as const };
      work = { kind: 'loading', request };
      error = '';
      return request;
    },
    receivedReset(
      controller: AbortController,
      sessionEpoch: number,
      messages: NotificationMessage[],
      olderCursor: string | null,
      newerCursor?: string | null
    ) {
      if (!owns(controller)) return;
      history = initialHistory(sessionEpoch, messages, olderCursor, newerCursor);
      error = '';
    },
    failed(controller: AbortController, message: string) {
      if (owns(controller)) error = message;
    },
    finished(controller: AbortController) {
      if (work.kind === 'loading' && work.request.controller === controller) work = { kind: 'idle' };
    }
  };
}
