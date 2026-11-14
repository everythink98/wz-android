import type { NotificationMessage } from '@/domain/notifications/models';

type History = {
  sessionEpoch: number;
  messages: NotificationMessage[];
  olderCursor: string | null;
  consumedCursors: string[];
  blocked?: boolean;
};
type Request =
  | Readonly<{ controller: AbortController; kind: 'reset' }>
  | Readonly<{ controller: AbortController; kind: 'earlier'; cursor: string; consumedCursors: readonly string[] }>;
type Work =
  | { kind: 'idle' }
  | { kind: 'loading'; request: Request }
  | { kind: 'awaiting-commit'; request: Extract<Request, { kind: 'earlier' }> };
type Snapshot = Readonly<{ history: History | undefined; busy: boolean; error: string }>;

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
      if (work.kind === 'awaiting-commit' && value?.consumedCursors.at(-1) === work.request.cursor)
        work = { kind: 'idle' };
    },
    resetScope() {
      cancel();
      history = undefined;
      error = '';
    },
    latest(sessionEpoch: number, messages: NotificationMessage[], olderCursor: string | null) {
      const current = committed?.sessionEpoch === sessionEpoch ? committed : undefined;
      const ids = new Set(messages.map((message) => message.id));
      const overlap = current?.messages.some((message) => ids.has(message.id));
      const start = current?.messages.findIndex((message) => message.id === messages[0]?.id) ?? -1;
      const resetting = work.kind !== 'idle' && work.request.kind === 'reset';
      if (current && start >= 0 && !resetting) {
        history = { ...current, messages: [...current.messages.slice(0, start), ...messages] };
        return;
      }
      if (current?.messages.length && !resetting) {
        cancel();
        error = overlap
          ? '最新消息范围已变化，已重新从最新消息开始；可继续加载更早消息。'
          : '最新消息与已加载历史不连续，已重新从最新消息开始；可继续加载更早消息。';
      }
      history = { sessionEpoch, messages, olderCursor, consumedCursors: [] };
    },
    beginEarlier(sessionEpoch: number) {
      if (
        work.kind !== 'idle' ||
        !committed?.olderCursor ||
        committed.blocked ||
        committed.sessionEpoch !== sessionEpoch
      )
        return null;
      const request = {
        controller: new AbortController(),
        kind: 'earlier' as const,
        cursor: committed.olderCursor,
        consumedCursors: committed.consumedCursors
      };
      work = { kind: 'loading', request };
      error = '';
      return request;
    },
    receivedEarlier(
      controller: AbortController,
      page: { messages: NotificationMessage[]; olderCursor: string | null }
    ) {
      if (work.kind !== 'loading' || work.request.kind !== 'earlier' || !owns(controller) || !history || !committed)
        return;
      const request = work.request;
      const consumedCursors = [...request.consumedCursors, request.cursor];
      const repeated = page.olderCursor !== null && consumedCursors.includes(page.olderCursor);
      if (repeated) error = '原站历史游标重复，已停止加载；请重新读取会话后重试。';
      history = {
        ...history,
        messages: Array.from(
          new Map([...page.messages, ...history.messages].map((message) => [message.id, message])).values()
        ),
        olderCursor: repeated ? request.cursor : page.olderCursor,
        blocked: repeated,
        consumedCursors
      };
      work = { kind: 'awaiting-commit', request };
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
      olderCursor: string | null
    ) {
      if (!owns(controller)) return;
      history = { sessionEpoch, messages, olderCursor, consumedCursors: [] };
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
