import { accountSessionSnapshotFromEvent, createAccountSessionSnapshot } from '@/domain/session/siteSessionState';
import { accountQueryKeys, appQueryClient } from '@/platform/query/serverState';

export function seedLinuxDoAccount(username = 'alice') {
  const snapshot = accountSessionSnapshotFromEvent(createAccountSessionSnapshot('linuxdo'), {
    type: 'session-updated',
    loggedIn: true,
    currentUser: { source: 'linuxdo', id: username, username, url: `https://linux.do/u/${username}` }
  });
  appQueryClient.setQueryData(accountQueryKeys.snapshot('linuxdo'), snapshot);
  return snapshot;
}
