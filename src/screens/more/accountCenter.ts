import { sourceLabel } from '../../appUtils';
import type { CredentialSummaries, CredentialSummary } from '../../credentialVault';
import type { SessionSite, SiteSessionViewModels } from '../../siteSessionState';
import type { UserProfile } from '../../types';

export type { CredentialSummaries } from '../../credentialVault';
export type AccountPrimaryAction = 'open-user' | 'open-login' | 'open-login-with-fill' | 'none';

export type SiteAccountView = {
  site: SessionSite;
  label: string;
  identityLabel: string;
  rowSummary: string;
  statusLabel: string;
  credential: CredentialSummary;
  isLoggedIn: boolean;
  primaryAction: AccountPrimaryAction;
  primaryLabel: string;
  primaryDisabled: boolean;
  needsAttention: boolean;
  user?: UserProfile;
};

const sites = ['nodeseek', 'linuxdo', 'yaohuo'] as const satisfies readonly SessionSite[];

function primaryActionFor(view: SiteSessionViewModels[SessionSite], hasCredential: boolean) {
  if (view.status === 'verifying') {
    return { action: 'none' as const, label: '验证中', disabled: true };
  }
  if (view.status === 'verification-required') {
    return { action: 'open-login' as const, label: '去验证', disabled: false };
  }
  if (view.isLoggedIn) {
    return view.currentUser
      ? { action: 'open-user' as const, label: '查看我的主页', disabled: false }
      : { action: 'none' as const, label: '已登录', disabled: true };
  }
  if (view.status === 'expired') {
    return hasCredential
      ? { action: 'open-login-with-fill' as const, label: '重新登录并填入', disabled: false }
      : { action: 'open-login' as const, label: '重新登录', disabled: false };
  }
  if (view.status === 'verified') {
    return hasCredential
      ? { action: 'open-login-with-fill' as const, label: '继续登录并填入', disabled: false }
      : { action: 'open-login' as const, label: '继续登录', disabled: false };
  }
  return hasCredential
    ? { action: 'open-login-with-fill' as const, label: '登录并填入', disabled: false }
    : { action: 'open-login' as const, label: '登录', disabled: false };
}

export function createSiteAccountViews(
  sessions: SiteSessionViewModels,
  credentials: CredentialSummaries,
  nodeSeekUserId: number | null = null
): SiteAccountView[] {
  return sites.map((site) => {
    const session = sessions[site];
    const credential = credentials[site];
    const user = session.currentUser;
    const identityLabel = user?.displayName
      || user?.username
      || (site === 'nodeseek' && session.isLoggedIn && nodeSeekUserId ? `用户 ${nodeSeekUserId}` : '')
      || (session.isLoggedIn ? '身份未识别' : session.summaryLabel);
    const primary = primaryActionFor(session, credential.hasCredential);
    const credentialLabel = credential.state === 'invalidated'
      ? '自动填入需重新设置'
      : credential.hasCredential
        ? '可自动填入'
        : '未设置自动填入';
    const statusAndCredential = `${session.summaryLabel} · ${credentialLabel}`;
    return {
      site,
      label: sourceLabel(site),
      identityLabel,
      rowSummary: user || session.isLoggedIn ? `${identityLabel} · ${statusAndCredential}` : statusAndCredential,
      statusLabel: session.summaryLabel,
      credential,
      isLoggedIn: session.isLoggedIn,
      primaryAction: primary.action,
      primaryLabel: primary.label,
      primaryDisabled: primary.disabled,
      needsAttention: credential.state === 'invalidated'
        || session.status === 'expired'
        || session.status === 'verification-required',
      ...(user ? { user } : {})
    };
  });
}

export function accountCenterSummary(views: SiteAccountView[]) {
  const needsAttention = views.filter((view) => view.needsAttention).length;
  const loggedIn = views.filter((view) => view.isLoggedIn).length;
  const saved = views.filter((view) => view.credential.hasCredential).length;
  return `待处理 ${needsAttention} · 网站登录 ${loggedIn}/3 · 自动填入 ${saved}/3`;
}
