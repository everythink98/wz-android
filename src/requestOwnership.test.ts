import { describe, expect, it } from 'vitest';
import {
  createRequestOwner,
  isCurrentOwnedRequest,
  isOwnedRequest,
  startOwnedRequest,
  supersedeRequest,
  type RequestOwner
} from './requestOwnership';

describe('request ownership', () => {
  it('rejects stale results after a newer request starts for the same lane', () => {
    let owner: RequestOwner = createRequestOwner();
    const feedA = owner;
    owner = supersedeRequest(owner, 'feed:all');
    const feedB = owner;

    expect(isOwnedRequest(feedA, owner)).toBe(false);
    expect(isOwnedRequest(feedB, owner)).toBe(true);
  });

  it('keeps unrelated lanes independent', () => {
    let feedOwner = supersedeRequest(createRequestOwner(), 'feed:nodeseek');
    let topicOwner = supersedeRequest(createRequestOwner(), 'topic:nodeseek:1');
    const topicRequest = topicOwner;

    feedOwner = supersedeRequest(feedOwner, 'feed:linuxdo');

    expect(isOwnedRequest(topicRequest, topicOwner)).toBe(true);
    expect(feedOwner.key).toBe('feed:linuxdo');
  });

  it('can name a request by the page state it belongs to', () => {
    let owner = createRequestOwner('search');

    owner = supersedeRequest(owner, 'search:all:react');
    const searchForReact = owner;
    owner = supersedeRequest(owner, 'search:nodeseek:android');

    expect(isOwnedRequest(searchForReact, owner)).toBe(false);
    expect(owner).toEqual({ key: 'search:nodeseek:android', token: 2 });
  });

  it('updates a shared current owner and checks request snapshots against it', () => {
    const ownerRef = { current: createRequestOwner('topic') };
    const topicA = startOwnedRequest(ownerRef, 'topic:nodeseek:1');
    const topicB = startOwnedRequest(ownerRef, 'topic:nodeseek:2');

    expect(isCurrentOwnedRequest(topicA, ownerRef)).toBe(false);
    expect(isCurrentOwnedRequest(topicB, ownerRef)).toBe(true);
  });
});
