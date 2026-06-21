import { describe, expect, it } from 'vitest';
import { createRequestOwner, startOwnedRequest } from './requestOwnership';
import { isCurrentTopicLoadRequest } from './topicRequestState';

describe('topic request state', () => {
  it('keeps a topic load current only while owner, id, and topic key all match', () => {
    const ownerRef = { current: createRequestOwner('topic') };
    const requestOwner = startOwnedRequest(ownerRef, 'topic:nodeseek:1:cache');
    const requestIdRef = { current: 1 };
    const currentTopicKeyRef = { current: 'nodeseek:1' };

    expect(isCurrentTopicLoadRequest({
      currentTopicKeyRef,
      ownerRef,
      requestId: 1,
      requestIdRef,
      requestOwner,
      requestTopicKey: 'nodeseek:1'
    })).toBe(true);
  });

  it('rejects stale topic loads after the current topic key changes', () => {
    const ownerRef = { current: createRequestOwner('topic') };
    const requestOwner = startOwnedRequest(ownerRef, 'topic:nodeseek:1:cache');
    const requestIdRef = { current: 1 };
    const currentTopicKeyRef = { current: 'nodeseek:2' };

    expect(isCurrentTopicLoadRequest({
      currentTopicKeyRef,
      ownerRef,
      requestId: 1,
      requestIdRef,
      requestOwner,
      requestTopicKey: 'nodeseek:1'
    })).toBe(false);
  });

  it('rejects stale topic loads after a newer request starts', () => {
    const ownerRef = { current: createRequestOwner('topic') };
    const requestOwner = startOwnedRequest(ownerRef, 'topic:nodeseek:1:cache');
    startOwnedRequest(ownerRef, 'topic:nodeseek:2:cache');
    const requestIdRef = { current: 2 };
    const currentTopicKeyRef = { current: 'nodeseek:1' };

    expect(isCurrentTopicLoadRequest({
      currentTopicKeyRef,
      ownerRef,
      requestId: 1,
      requestIdRef,
      requestOwner,
      requestTopicKey: 'nodeseek:1'
    })).toBe(false);
  });
});
