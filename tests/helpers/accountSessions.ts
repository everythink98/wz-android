import type { CredentialSummaries } from '@/platform/storage/credentialVault';
import {
  accountSessionSnapshotFromObservation,
  createAccountSessionSnapshot,
  createAccountSessionViewModel,
  type SiteSessionStates,
  type SiteSessionViewModels
} from '@/domain/session/siteSessionState';
import type { UserProfile } from '@/domain/forum/models';

export function testAccountUser(source: keyof SiteSessionStates): UserProfile {
  return { source, id: '123', username: 'fixture-user', url: `https://account.invalid/${source}/123`, topics: [] };
}

export function projectTestAccountSessions(states: SiteSessionStates): SiteSessionViewModels {
  const project = (site: keyof SiteSessionStates) =>
    createAccountSessionViewModel(
      accountSessionSnapshotFromObservation(createAccountSessionSnapshot(site), { session: states[site] })
    );
  return { nodeseek: project('nodeseek'), linuxdo: project('linuxdo'), yaohuo: project('yaohuo') };
}

export function emptyCredentialSummaries(): CredentialSummaries {
  return {
    nodeseek: { site: 'nodeseek', state: 'missing', hasCredential: false, protection: null },
    linuxdo: { site: 'linuxdo', state: 'missing', hasCredential: false, protection: null },
    yaohuo: { site: 'yaohuo', state: 'missing', hasCredential: false, protection: null }
  };
}
