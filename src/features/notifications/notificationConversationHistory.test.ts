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
