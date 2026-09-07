import { describe, expect, it } from 'vitest';
import { createSiteSessionViewModel, createSiteSessionStates } from '@/domain/session/siteSessionState';
import type { TopicDetail } from '@/domain/forum/models';
import { decideTopicAction, topicActionDecisionMessage } from './topicActionDecision';

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
  it('forbids replies and uploads on ended Yaohuo topics while preserving bookmarks', () => {
    const ended: TopicDetail = { ...topic, source: 'yaohuo', closed: true };
    for (const action of ['reply', 'upload'] as const) {
      const decision = decideTopicAction({ account: loggedIn, action, topic: ended, objectAllowed: true });
      expect(decision.allowed).toBe(false);
      expect(topicActionDecisionMessage(decision)).toBe('本帖已结束，无法回复');
    }
    expect(decideTopicAction({ account: loggedIn, action: 'bookmark', topic: ended }).allowed).toBe(true);
  });
  it.each([
    ['unsupported', { topic: { ...topic, source: 'v2ex' } }],
    ['login-required', { account: createSiteSessionViewModel(createSiteSessionStates().linuxdo) }],
    ['identity-unavailable', { account: { ...loggedIn, canWrite: false, identityTrust: 'unknown' } }],
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

  it('explains terminal unknown without claiming that the user logged out', () => {
    const decision = decideTopicAction({
      account: { ...loggedIn, canWrite: false, identityTrust: 'unknown' },
      action: 'reply',
      topic
    });

    expect(decision).toEqual({ allowed: false, reason: 'identity-unavailable' });
    expect(topicActionDecisionMessage(decision)).toBe('账号状态暂不可确认，请重试账号核对');
  });

  it('keeps an optimistic completed target visibly pending until transport settles', () => {
    expect(
      decideTopicAction({ account: loggedIn, action: 'reply', topic, alreadyComplete: true, pending: true })
    ).toEqual({
      allowed: false,
      reason: 'pending'
    });
  });
});
