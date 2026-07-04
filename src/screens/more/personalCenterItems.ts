import { sourceLabel } from '../../appUtils';
import type { SessionSite, SiteSessionViewModels } from '../../siteSessionState';
import type { UserProfile } from '../../types';

const personalCenterSources = ['nodeseek', 'linuxdo', 'yaohuo'] as const satisfies readonly SessionSite[];

export interface PersonalCenterItem {
  source: SessionSite;
  label: string;
  value: string;
  canOpen: boolean;
  user?: UserProfile;
}

export function createPersonalCenterItems(sessionViewModels: SiteSessionViewModels): PersonalCenterItem[] {
  return personalCenterSources.map((source) => {
    const session = sessionViewModels[source];
    const user = session.currentUser;
    const canOpen = Boolean(session.isLoggedIn && user);
    return {
      source,
      label: sourceLabel(source),
      value: user?.displayName || user?.username || (session.isLoggedIn ? '身份未识别' : session.summaryLabel),
      canOpen,
      ...(user ? { user } : {})
    };
  });
}
