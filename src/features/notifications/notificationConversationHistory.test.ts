import { expect, it } from 'vitest';
import { createNotificationConversationHistory } from './notificationConversationHistory';

it('keeps an earlier page when the latest window arrives before the UI commits', () => {
  const flow = createNotificationConversationHistory();
  const message = (id: string) => ({ id, author: 'member', createdAt: null });
  flow.latest(0, [message('2')], 'older');
  flow.observedCommit(flow.snapshot.history);
  const earlier = flow.beginEarlier(0)!;
  flow.receivedEarlier(earlier.controller, { messages: [message('1')], olderCursor: null });
  flow.latest(0, [message('2'), message('3')], null);
  flow.observedCommit(flow.snapshot.history);
  expect(flow.committed?.messages.map(({ id }) => id)).toEqual(['1', '2', '3']);
  expect(flow.pending).toBe(false);
});

it('preserves both loaded sides around the original message after an anchored refresh', () => {
  const flow = createNotificationConversationHistory();
  const message = (id: string) => ({ id, author: '系统', createdAt: null });
  const window = [message('2'), message('3'), message('4')];
  flow.latest(0, window, 'earlier', 'later');
  flow.observedCommit(flow.snapshot.history);
  const earlier = flow.beginEarlier(0)!;
  flow.receivedEarlier(earlier.controller, { messages: [message('1')], olderCursor: null });
  flow.observedCommit(flow.snapshot.history);
  const later = flow.beginLater(0)!;
  expect(flow.beginLater(0)).toBeNull();
  flow.receivedLater(later.controller, { messages: [message('4'), message('5')], newerCursor: 'next' });
  flow.latest(0, window, 'earlier', 'later');
  flow.observedCommit(flow.snapshot.history);
  expect(flow.committed?.messages.map(({ id }) => id)).toEqual(['1', '2', '3', '4', '5']);
  expect(flow.committed?.olderCursor).toBeNull();
  expect(flow.beginLater(0)?.cursor).toBe('next');
});

it.each(['earlier', 'later'] as const)(
  'retires an obsolete %s request when the latest window replaces its cursors',
  (side) => {
    const flow = createNotificationConversationHistory();
    const message = (id: string) => ({ id, author: 'member', createdAt: null });
    const window = [message('2'), message('3')];
    flow.latest(0, window, 'old-earlier', 'old-later');
    flow.observedCommit(flow.snapshot.history);
    const stale = side === 'earlier' ? flow.beginEarlier(0)! : flow.beginLater(0)!;
    flow.latest(0, [...window, message('4')], 'new-earlier');
    flow.observedCommit(flow.snapshot.history);
    expect(stale.controller.signal.aborted).toBe(true);
    if (side === 'earlier') flow.receivedEarlier(stale.controller, { messages: [message('stale')], olderCursor: null });
    else flow.receivedLater(stale.controller, { messages: [message('stale')], newerCursor: null });
    expect(flow.committed?.messages.map(({ id }) => id)).toEqual(['2', '3', '4']);
    expect(flow.beginLater(0)).toBeNull();
    expect(flow.beginEarlier(0)?.cursor).toBe('new-earlier');
  }
);

it('waits for the new window to render before accepting a tap from the previous window', () => {
  const flow = createNotificationConversationHistory();
  const message = { id: '2', author: 'member', createdAt: null };
  flow.latest(0, [message], 'old-earlier', 'old-later');
  flow.observedCommit(flow.snapshot.history);
  flow.latest(0, [message], 'new-earlier');
  expect(flow.beginLater(0)).toBeNull();
  expect(flow.beginEarlier(0)).toBeNull();
  flow.observedCommit(flow.snapshot.history);
  expect(flow.beginEarlier(0)?.cursor).toBe('new-earlier');
  flow.resetScope();
  expect(flow.beginEarlier(0)).toBeNull();
});
