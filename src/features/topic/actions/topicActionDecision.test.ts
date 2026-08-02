import { describe, expect, it } from 'vitest';
import { createSiteSessionViewModel, createSiteSessionStates } from '@/domain/session/siteSessionState';
import type { TopicDetail } from '@/domain/forum/models';
import { decideTopicAction } from './topicActionDecision';

const topic = { source: 'linuxdo', id: '42', canCreatePost: true } as TopicDetail;
const loggedIn = createSiteSessionViewModel({
  ...createSiteSessionStates().linuxdo,
  status: 'logged-in',
  currentUser: {
    source: 'linuxdo',
    id: '7',
    username: 'alice',
    url: 'https://linux.do/u/alice',
    topics: []
  }
});

describe('topic action decision', () => {
  it.each([
    ['unsupported', { topic: { ...topic, source: 'v2ex' } }],
    ['login-required', { account: createSiteSessionViewModel(createSiteSessionStates().linuxdo) }],
    ['identity-pending', { account: { ...loggedIn, identityTrust: 'pending' } }],
    ['object-forbidden', { account: loggedIn, objectAllowed: false }],
    ['missing-target', { account: loggedIn, targetPresent: false }],
    ['already-complete', { account: loggedIn, alreadyComplete: true }],
    ['pending', { account: loggedIn, pending: true }]
  ] as const)('returns %s from the single write eligibility chain', (reason, overrides) => {
    expect(decideTopicAction({ account: loggedIn, action: 'reply', topic, ...overrides })).toEqual({
      allowed: false,
      reason
    });
  });

  it('allows one complete writable target', () => {
    expect(decideTopicAction({ account: loggedIn, action: 'reply', topic })).toEqual({
      allowed: true,
      reason: 'allowed'
    });
  });
});
