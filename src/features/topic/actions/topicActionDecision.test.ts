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
    url: 'https://linux.do/u/alice'
  }
});

describe('topic action decision', () => {
  it('allows reading confirmation on a closed linux.do topic through the same account and object guards', () => {
    expect(decideTopicAction({ account: loggedIn, action: 'policy', topic: { ...topic, closed: true } }).allowed).toBe(
      true
    );
    expect(decideTopicAction({ account: loggedIn, action: 'policy', topic, objectAllowed: false }).reason).toBe(
      'object-forbidden'
    );
    expect(decideTopicAction({ account: { ...loggedIn, canWrite: false }, action: 'policy', topic }).reason).toBe(
      'login-required'
    );
    for (const source of ['nodeseek', 'yaohuo', 'v2ex'] as const) {
      expect(decideTopicAction({ account: loggedIn, action: 'policy', topic: { ...topic, source } }).reason).toBe(
        'unsupported'
      );
    }
  });
  it.each([
    ['yaohuo', '本帖已结束，无法回复'],
    ['linuxdo', '本帖已关闭，无法回复']
  ] as const)('forbids replies and uploads on closed %s topics while preserving bookmarks', (source, message) => {
    const ended: TopicDetail = { ...topic, source, closed: true };
    for (const action of ['reply', 'upload'] as const) {
      const decision = decideTopicAction({ account: loggedIn, action, topic: ended, objectAllowed: true });
      expect(decision.allowed).toBe(false);
      expect(topicActionDecisionMessage(decision)).toBe(message);
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
