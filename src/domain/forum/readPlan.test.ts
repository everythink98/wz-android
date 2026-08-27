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
    identityTrust: 'unknown',
    sessionEpoch: 3,
    sourceEnabled: true,
    ...overrides
  };
}

describe('forum read plans', () => {
  it('keeps public reads available while identity is unknown or an auth surface is open', () => {
    expect(
      ['v2ex', 'linuxdo', 'nodeseek'].filter((source) =>
        forumReadOperationIsPublic(source as SessionRuntimeSnapshot['source'] | 'v2ex', 'search')
      )
    ).toEqual(['v2ex', 'linuxdo', 'nodeseek']);
    expect(forumReadOperationIsPublic('yaohuo', 'search')).toBe(false);
    expect(resolveForumReadPlan('v2ex', 'topic', true)).toEqual({
      state: 'ready',
      lane: 'public',
      transport: 'native-no-cookie',
      cacheScope: 'public:omit'
    });
    expect(resolveForumReadPlan('linuxdo', 'topic', true, session('linuxdo'))).toMatchObject({
      state: 'ready',
      lane: 'public',
      cacheScope: 'public:omit'
    });
    expect(resolveForumReadPlan('linuxdo', 'search', true, session('linuxdo'))).toMatchObject({
      state: 'ready',
      lane: 'public',
      transport: 'none'
    });
    expect(resolveForumReadPlan('nodeseek', 'search', true, session('nodeseek'))).toMatchObject({
      state: 'ready',
      lane: 'public',
      transport: 'none'
    });
    expect(
      resolveForumReadPlan(
        'linuxdo',
        'user-profile',
        true,
        session('linuxdo', { authenticated: true, authSurfaceOpen: true, identityTrust: 'confirmed' })
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
      reason: 'identity-unavailable',
      cacheScope: 'blocked:identity-unavailable'
    });
    expect(resolveForumReadPlan('yaohuo', 'topic', true, session('yaohuo', { identityTrust: 'none' }))).toEqual({
      state: 'blocked',
      reason: 'login-required',
      cacheScope: 'blocked:login-required'
    });
  });

  it.each<ForumReadOperation>(['user-resolution', 'semantic-search', 'search-tags', 'search-users', 'level'])(
    'keeps %s credential-required while identity is unknown',
    (operation) => {
      const source = operation === 'user-resolution' ? 'nodeseek' : 'linuxdo';
      expect(resolveForumReadPlan(source, operation, true, session(source))).toEqual({
        state: 'blocked',
        reason: 'identity-unavailable',
        cacheScope: 'blocked:identity-unavailable'
      });
    }
  );

  it('keeps unknown identity terminal without blocking public reads or pretending logout', () => {
    const unknown = session('linuxdo', { identityTrust: 'unknown' });
    expect(resolveForumReadPlan('linuxdo', 'topic', true, unknown)).toMatchObject({
      state: 'ready',
      lane: 'public',
      cacheScope: 'public:omit'
    });
    expect(resolveForumReadPlan('linuxdo', 'level', true, unknown)).toEqual({
      state: 'blocked',
      reason: 'identity-unavailable',
      cacheScope: 'blocked:identity-unavailable'
    });
  });

  it('isolates authenticated cache scope and makes disabled state authoritative', () => {
    const authenticated = resolveForumReadPlan(
      'linuxdo',
      'topic',
      true,
      session('linuxdo', {
        authenticated: true,
        identityKey: 'linuxdo:42',
        identityTrust: 'confirmed',
        sessionEpoch: 8
      })
    );
    const publicPlan = resolveForumReadPlan('linuxdo', 'topic', true, session('linuxdo'));

    expect(authenticated).toMatchObject({
      state: 'ready',
      lane: 'authenticated',
      cacheScope: 'authenticated:8'
    });
    expect(authenticated.cacheScope).not.toBe(publicPlan.cacheScope);
    expect(resolveForumReadPlan('linuxdo', 'topic', false, session('linuxdo'))).toEqual({
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
