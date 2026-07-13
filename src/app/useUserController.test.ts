import { describe, expect, it } from 'vitest';
import { userRouteSnapshotNeedsReload, userSourceRecoveryTarget } from './useUserController';

describe('user source recovery routing', () => {
  it('routes Yaohuo verification errors back to the in-app login and verification surface', () => {
    expect(userSourceRecoveryTarget('yaohuo', {
      kind: 'verification-required',
      message: '妖火需要完成访问验证'
    })).toBe('yaohuo-login');
  });

  it('does not treat an ordinary Yaohuo failure as a login recovery event', () => {
    expect(userSourceRecoveryTarget('yaohuo', {
      kind: 'ordinary',
      message: '请求超时'
    })).toBeNull();
  });
});

describe('user route request restoration', () => {
  const user = {
    source: 'nodeseek' as const,
    id: '7',
    username: 'alice',
    displayName: 'Alice',
    url: 'https://www.nodeseek.com/space/7',
    topics: []
  };

  it('reloads a route whose initial profile request was interrupted', () => {
    expect(userRouteSnapshotNeedsReload({
      requestPending: true,
      selectedUser: user,
      userProfile: null,
      userError: null
    })).toBe(true);
  });

  it('does not reload completed or failed route snapshots', () => {
    expect(userRouteSnapshotNeedsReload({ requestPending: false, selectedUser: user, userProfile: null, userError: null })).toBe(false);
    expect(userRouteSnapshotNeedsReload({ requestPending: true, selectedUser: user, userProfile: user, userError: null })).toBe(false);
    expect(userRouteSnapshotNeedsReload({
      requestPending: true,
      selectedUser: user,
      userProfile: null,
      userError: { kind: 'ordinary', message: 'failed' }
    })).toBe(false);
  });
});
