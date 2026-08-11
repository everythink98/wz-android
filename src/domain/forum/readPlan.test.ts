import { describe, expect, it } from 'vitest';
import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';
import {
  forumReadOperationIsPublic,
  forumReadPlanScopesKey,
  resolveForumReadPlan,
  type ForumReadOperation
} from './readPlan';

function session(
  source: SessionRuntimeSnapshot['source'],
  overrides: Partial<SessionRuntimeSnapshot> = {}
): SessionRuntimeSnapshot {
  return {
    source,
    authenticated: false,
    authSurfaceOpen: false,
    identityKey: `${source}:anonymous`,
    identityTrust: 'pending',
    sessionEpoch: 3,
    sourceEnabled: true,
    ...overrides
  };
}

describe('forum read plans', () => {
  it('keeps public reads available while identity is pending or an auth surface is open', () => {
    expect(
      ['v2ex', 'linuxdo', 'nodeseek', 'xiaoyinsi'].filter((source) =>
        forumReadOperationIsPublic(source as SessionRuntimeSnapshot['source'] | 'v2ex', 'search')
      )
    ).toEqual(['v2ex', 'linuxdo', 'nodeseek', 'xiaoyinsi']);
    expect(forumReadOperationIsPublic('yaohuo', 'search')).toBe(false);
    expect(resolveForumReadPlan('v2ex', 'topic', true)).toEqual({
      state: 'ready',
      lane: 'public',
      transport: 'native-no-cookie',
      cacheScope: 'public:omit'
    });
    expect(resolveForumReadPlan('xiaoyinsi', 'topic', true, session('xiaoyinsi'))).toMatchObject({
      state: 'ready',
      lane: 'public',
      cacheScope: 'public:omit'
    });
    expect(
      resolveForumReadPlan(
        'xiaoyinsi',
        'user-profile',
        true,
        session('xiaoyinsi', { authenticated: true, authSurfaceOpen: true, identityTrust: 'confirmed' })
      )
    ).toMatchObject({ state: 'ready', lane: 'public', cacheScope: 'public:omit' });
  });

  it('separates Yaohuo local categories from its credential-required remote reads', () => {
    expect(resolveForumReadPlan('yaohuo', 'categories', true, session('yaohuo'))).toEqual({
      state: 'ready',
      lane: 'local',
      transport: 'none',
      cacheScope: 'local'
    });
    expect(resolveForumReadPlan('yaohuo', 'feed', true, session('yaohuo'))).toEqual({
      state: 'blocked',
      reason: 'identity-pending',
      cacheScope: 'blocked:identity-pending'
    });
    expect(resolveForumReadPlan('yaohuo', 'topic', true, session('yaohuo', { identityTrust: 'none' }))).toEqual({
      state: 'blocked',
      reason: 'login-required',
      cacheScope: 'blocked:login-required'
    });
  });

  it.each<ForumReadOperation>(['user-resolution', 'semantic-search', 'search-tags', 'search-users', 'level'])(
    'keeps %s credential-required while identity is pending',
    (operation) => {
      const source = operation === 'user-resolution' ? 'nodeseek' : 'linuxdo';
      expect(resolveForumReadPlan(source, operation, true, session(source))).toEqual({
        state: 'blocked',
        reason: 'identity-pending',
        cacheScope: 'blocked:identity-pending'
      });
    }
  );

  it('keeps unknown identity terminal without blocking public reads or pretending logout', () => {
    const unknown = session('xiaoyinsi', { identityTrust: 'unknown' });
    expect(resolveForumReadPlan('xiaoyinsi', 'topic', true, unknown)).toMatchObject({
      state: 'ready',
      lane: 'public',
      cacheScope: 'public:omit'
    });
    expect(resolveForumReadPlan('xiaoyinsi', 'level', true, unknown)).toEqual({
      state: 'blocked',
      reason: 'identity-unavailable',
      cacheScope: 'blocked:identity-unavailable'
    });
  });

  it('isolates authenticated cache scope and makes disabled state authoritative', () => {
    const authenticated = resolveForumReadPlan(
      'xiaoyinsi',
      'topic',
      true,
      session('xiaoyinsi', {
        authenticated: true,
        identityKey: 'xiaoyinsi:42',
        identityTrust: 'confirmed',
        sessionEpoch: 8
      })
    );
    const publicPlan = resolveForumReadPlan('xiaoyinsi', 'topic', true, session('xiaoyinsi'));

    expect(authenticated).toMatchObject({
      state: 'ready',
      lane: 'authenticated',
      cacheScope: 'authenticated:8'
    });
    expect(authenticated.cacheScope).not.toBe(publicPlan.cacheScope);
    expect(resolveForumReadPlan('xiaoyinsi', 'topic', false, session('xiaoyinsi'))).toEqual({
      state: 'blocked',
      reason: 'source-disabled',
      cacheScope: 'blocked:source-disabled'
    });
  });

  it('canonicalizes an aggregate plan snapshot without making user order part of the key', () => {
    expect(
      forumReadPlanScopesKey([
        ['v2ex', 'public:omit'],
        ['nodeseek', 'authenticated:4']
      ])
    ).toBe(
      forumReadPlanScopesKey([
        ['nodeseek', 'authenticated:4'],
        ['v2ex', 'public:omit']
      ])
    );
    expect(forumReadPlanScopesKey([['v2ex', 'public:omit']])).not.toBe(
      forumReadPlanScopesKey([['v2ex', 'blocked:source-disabled']])
    );
  });
});
