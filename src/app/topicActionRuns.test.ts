import { describe, expect, it } from 'vitest';
import {
  abortTopicActionRuns,
  clearBusyTopicActionRuns,
  finishBusyTopicActionRun,
  finishTopicActionRun,
  isCurrentTopicActionRun,
  trackBusyTopicActionRun,
  startTopicActionRun,
  type TopicActionBusyRunSet,
  type TopicActionRunMap
} from './topicActionRuns';

describe('topic action cancellation runs', () => {
  it('keeps different action keys active at the same time', () => {
    const actionRuns = { current: {} as TopicActionRunMap };
    const likeRun = startTopicActionRun(actionRuns, 'topic:1:post:1:like');
    const bookmarkRun = startTopicActionRun(actionRuns, 'topic:1:bookmark');

    expect(isCurrentTopicActionRun(likeRun, actionRuns)).toBe(true);
    expect(isCurrentTopicActionRun(bookmarkRun, actionRuns)).toBe(true);
    expect(finishTopicActionRun(likeRun, actionRuns)).toBe(false);
    expect(finishTopicActionRun(bookmarkRun, actionRuns)).toBe(true);
  });

  it('aborts only the previous run for the same action key', () => {
    const actionRuns = { current: {} as TopicActionRunMap };
    const firstLikeRun = startTopicActionRun(actionRuns, 'topic:1:post:1:like');
    const bookmarkRun = startTopicActionRun(actionRuns, 'topic:1:bookmark');
    const secondLikeRun = startTopicActionRun(actionRuns, 'topic:1:post:1:like');

    expect(firstLikeRun.controller.signal.aborted).toBe(true);
    expect(bookmarkRun.controller.signal.aborted).toBe(false);
    expect(isCurrentTopicActionRun(secondLikeRun, actionRuns)).toBe(true);
  });

  it('aborts all active action runs', () => {
    const actionRuns = { current: {} as TopicActionRunMap };
    const likeRun = startTopicActionRun(actionRuns, 'topic:1:post:1:like');
    const bookmarkRun = startTopicActionRun(actionRuns, 'topic:1:bookmark');

    abortTopicActionRuns(actionRuns);

    expect(likeRun.controller.signal.aborted).toBe(true);
    expect(bookmarkRun.controller.signal.aborted).toBe(true);
  });

  it('keeps a newer busy run active when an old canceled run finishes', () => {
    const actionRuns = { current: {} as TopicActionRunMap };
    const busyRuns = { current: new Set<AbortController>() as TopicActionBusyRunSet };
    const oldRun = startTopicActionRun(actionRuns, 'topic:1:reply');
    trackBusyTopicActionRun(busyRuns, oldRun);
    abortTopicActionRuns(actionRuns);
    clearBusyTopicActionRuns(busyRuns);
    const newRun = startTopicActionRun(actionRuns, 'topic:2:reply');
    trackBusyTopicActionRun(busyRuns, newRun);

    expect(finishBusyTopicActionRun(busyRuns, oldRun)).toBe(true);
    expect(finishBusyTopicActionRun(busyRuns, newRun)).toBe(false);
  });

  it('clears topic-scoped busy runs without clearing detached runs', () => {
    const topicRuns = { current: {} as TopicActionRunMap };
    const detachedRuns = { current: {} as TopicActionRunMap };
    const busyRuns = { current: new Set<AbortController>() as TopicActionBusyRunSet };
    const replyRun = startTopicActionRun(topicRuns, 'topic:1:reply');
    const checkInRun = startTopicActionRun(detachedRuns, 'nodeseek:attendance');
    trackBusyTopicActionRun(busyRuns, replyRun);
    trackBusyTopicActionRun(busyRuns, checkInRun);

    for (const controller of abortTopicActionRuns(topicRuns)) {
      busyRuns.current.delete(controller);
    }

    expect(replyRun.controller.signal.aborted).toBe(true);
    expect(checkInRun.controller.signal.aborted).toBe(false);
    expect(busyRuns.current.has(checkInRun.controller)).toBe(true);
  });
});
