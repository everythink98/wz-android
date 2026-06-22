import { describe, expect, it } from 'vitest';
import { createRequestOwner } from './requestOwnership';
import {
  abortTopicActionRuns,
  clearBusyTopicActionRuns,
  finishBusyTopicActionRun,
  finishTopicActionRun,
  currentTopicActionRequestOwner,
  isCurrentTopicActionRequestOwner,
  isCurrentTopicActionRun,
  trackBusyTopicActionRun,
  startTopicActionRun,
  startTopicActionRequestOwner,
  type TopicActionBusyRunSet,
  type TopicActionOwnerMap,
  type TopicActionRunMap
} from './topicActionRequestOwners';

describe('topic action request owners', () => {
  it('keeps different action keys current at the same time', () => {
    const contextOwner = { current: createRequestOwner('topic-action') };
    const actionOwners = { current: {} as TopicActionOwnerMap };

    const likeOwner = startTopicActionRequestOwner(contextOwner, actionOwners, 'topic:1:post:1:like');
    const bookmarkOwner = startTopicActionRequestOwner(contextOwner, actionOwners, 'topic:1:bookmark');

    expect(isCurrentTopicActionRequestOwner(likeOwner, contextOwner, actionOwners)).toBe(true);
    expect(isCurrentTopicActionRequestOwner(bookmarkOwner, contextOwner, actionOwners)).toBe(true);
  });

  it('supersedes only the same action key', () => {
    const contextOwner = { current: createRequestOwner('topic-action') };
    const actionOwners = { current: {} as TopicActionOwnerMap };

    const firstLikeOwner = startTopicActionRequestOwner(contextOwner, actionOwners, 'topic:1:post:1:like');
    const bookmarkOwner = startTopicActionRequestOwner(contextOwner, actionOwners, 'topic:1:bookmark');
    const secondLikeOwner = startTopicActionRequestOwner(contextOwner, actionOwners, 'topic:1:post:1:like');

    expect(isCurrentTopicActionRequestOwner(firstLikeOwner, contextOwner, actionOwners)).toBe(false);
    expect(isCurrentTopicActionRequestOwner(secondLikeOwner, contextOwner, actionOwners)).toBe(true);
    expect(isCurrentTopicActionRequestOwner(bookmarkOwner, contextOwner, actionOwners)).toBe(true);
  });

  it('rejects old action owners after the topic context changes', () => {
    const contextOwner = { current: createRequestOwner('topic-action') };
    const actionOwners = { current: {} as TopicActionOwnerMap };
    const likeOwner = startTopicActionRequestOwner(contextOwner, actionOwners, 'topic:1:post:1:like');

    contextOwner.current = createRequestOwner('topic-action-context:topic:2');

    expect(isCurrentTopicActionRequestOwner(likeOwner, contextOwner, actionOwners)).toBe(false);
  });

  it('can reuse the current action owner without superseding an in-flight queue', () => {
    const contextOwner = { current: createRequestOwner('topic-action') };
    const actionOwners = { current: {} as TopicActionOwnerMap };
    const firstLikeOwner = startTopicActionRequestOwner(contextOwner, actionOwners, 'topic:1:post:1:like');

    const reusedLikeOwner = currentTopicActionRequestOwner(contextOwner, actionOwners, 'topic:1:post:1:like');

    expect(reusedLikeOwner.action).toEqual(firstLikeOwner.action);
    expect(isCurrentTopicActionRequestOwner(firstLikeOwner, contextOwner, actionOwners)).toBe(true);
    expect(isCurrentTopicActionRequestOwner(reusedLikeOwner, contextOwner, actionOwners)).toBe(true);
  });

  it('does not abort different action keys', () => {
    const actionRuns = { current: {} as TopicActionRunMap };

    const likeRun = startTopicActionRun(actionRuns, 'topic:1:post:1:like');
    const bookmarkRun = startTopicActionRun(actionRuns, 'topic:1:bookmark');

    expect(likeRun.controller.signal.aborted).toBe(false);
    expect(bookmarkRun.controller.signal.aborted).toBe(false);
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
    expect(secondLikeRun.controller.signal.aborted).toBe(false);
    expect(isCurrentTopicActionRun(firstLikeRun, actionRuns)).toBe(false);
    expect(isCurrentTopicActionRun(bookmarkRun, actionRuns)).toBe(true);
    expect(isCurrentTopicActionRun(secondLikeRun, actionRuns)).toBe(true);
  });

  it('aborts all active action runs', () => {
    const actionRuns = { current: {} as TopicActionRunMap };

    const likeRun = startTopicActionRun(actionRuns, 'topic:1:post:1:like');
    const bookmarkRun = startTopicActionRun(actionRuns, 'topic:1:bookmark');

    abortTopicActionRuns(actionRuns);

    expect(likeRun.controller.signal.aborted).toBe(true);
    expect(bookmarkRun.controller.signal.aborted).toBe(true);
    expect(isCurrentTopicActionRun(likeRun, actionRuns)).toBe(false);
    expect(isCurrentTopicActionRun(bookmarkRun, actionRuns)).toBe(false);
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

  it('can clear busy state for topic-scoped runs without clearing detached runs', () => {
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
