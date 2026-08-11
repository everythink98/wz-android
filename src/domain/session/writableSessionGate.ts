import type { IdentityTrust, SessionSite } from './siteSessionState';

export type SessionRuntimeSnapshot = {
  source: SessionSite;
  authenticated: boolean;
  authSurfaceOpen: boolean;
  identityKey: string;
  identityTrust: IdentityTrust;
  sessionEpoch: number;
  sourceEnabled?: boolean;
};
export type WritableSessionSnapshot = SessionRuntimeSnapshot;

export type WritableSessionTicket = Pick<WritableSessionSnapshot, 'source' | 'identityKey' | 'sessionEpoch'>;

export type WritableSessionReconcileResult = {
  status: 'anonymous' | 'changed' | 'same' | 'stale' | 'unknown';
};

export class WritableSessionBlockedError extends Error {
  constructor(
    message: string,
    readonly reason:
      'identity_changed' | 'identity_pending' | 'identity_unavailable' | 'login_required' | 'source-disabled' | 'stale'
  ) {
    super(message);
  }
}

function ticketFromSnapshot(snapshot: WritableSessionSnapshot): WritableSessionTicket {
  return {
    source: snapshot.source,
    identityKey: snapshot.identityKey,
    sessionEpoch: snapshot.sessionEpoch
  };
}

function canIssueTicket(snapshot: WritableSessionSnapshot) {
  return snapshot.sourceEnabled !== false && snapshot.authenticated && snapshot.identityTrust === 'confirmed';
}

export async function ensureWritableSessionTicket(
  readSnapshot: () => WritableSessionSnapshot,
  reconcile: () => Promise<WritableSessionReconcileResult>
) {
  const before = readSnapshot();
  if (before.sourceEnabled === false) {
    throw new WritableSessionBlockedError('当前来源已停用', 'source-disabled');
  }
  if (canIssueTicket(before) && !before.authSurfaceOpen) {
    return ticketFromSnapshot(before);
  }
  if (!before.authenticated && before.identityTrust === 'none' && !before.authSurfaceOpen) {
    throw new WritableSessionBlockedError('当前账号未登录', 'login_required');
  }

  const result = await reconcile();
  if (result.status !== 'same') {
    const reason =
      result.status === 'changed'
        ? 'identity_changed'
        : result.status === 'anonymous'
          ? 'login_required'
          : result.status === 'stale'
            ? 'stale'
            : result.status === 'unknown'
              ? 'identity_unavailable'
              : 'identity_pending';
    throw new WritableSessionBlockedError(
      result.status === 'changed'
        ? '账号已切换，请确认当前页面后重试'
        : result.status === 'anonymous'
          ? '当前账号已退出登录'
          : '登录状态暂时无法确认，请重试',
      reason
    );
  }

  const after = readSnapshot();
  if (!after.authenticated && after.identityTrust === 'none') {
    throw new WritableSessionBlockedError('当前账号未登录', 'login_required');
  }
  if (after.identityTrust !== 'confirmed' || after.authSurfaceOpen) {
    throw new WritableSessionBlockedError(
      '登录状态暂时无法确认，请重试',
      after.identityTrust === 'unknown' ? 'identity_unavailable' : 'identity_pending'
    );
  }
  if (
    after.source !== before.source ||
    after.identityKey !== before.identityKey ||
    after.sessionEpoch !== before.sessionEpoch
  ) {
    throw new WritableSessionBlockedError('登录状态已变化，请重试', 'identity_changed');
  }
  return ticketFromSnapshot(after);
}

export function validateWritableSessionTicket(ticket: WritableSessionTicket, snapshot: WritableSessionSnapshot) {
  return (
    snapshot.authenticated &&
    snapshot.sourceEnabled !== false &&
    !snapshot.authSurfaceOpen &&
    snapshot.identityTrust === 'confirmed' &&
    snapshot.source === ticket.source &&
    snapshot.identityKey === ticket.identityKey &&
    snapshot.sessionEpoch === ticket.sessionEpoch
  );
}
