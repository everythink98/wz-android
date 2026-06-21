import { describe, expect, it } from 'vitest';
import { createRequestOwner } from './requestOwnership';
import {
  currentTopicActionRequestOwner,
  isCurrentTopicActionRequestOwner,
  startTopicActionRequestOwner,
  type TopicActionOwnerMap
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
});
