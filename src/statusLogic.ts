import type { HealthDetail } from './appTypes';
import type { Source } from './types';

type StatusCheck = {
  ok: boolean;
  message?: string;
};

type LinuxDoAccessStatus = {
  hasClearance: boolean;
  loggedIn: boolean;
  savedAt?: string;
};

type LinuxDoLoginStatus = {
  ok: boolean;
  loginRequired?: boolean;
  message?: string;
};

const STATUS_SOURCES: Source[] = ['nodeseek', 'v2ex', 'linuxdo', 'yaohuo'];
const STATUS_LABELS: Record<Source, string> = {
  nodeseek: 'NodeSeek',
  v2ex: 'V2EX',
  linuxdo: 'linux.do',
  yaohuo: '妖火'
};

function defaultMessage(source: Source, check: StatusCheck) {
  if (check.message) {
    return check.message;
  }
  if (source === 'yaohuo') {
    return check.ok ? '登录可用' : '未登录';
  }
  return check.ok ? '列表可读取' : '不可用';
}

function linuxDoAccessText(access: LinuxDoAccessStatus) {
  if (access.loggedIn) {
    return `已登录 ${access.savedAt || ''}`;
  }
  if (access.hasClearance) {
    return `已验证 ${access.savedAt || ''}`;
  }
  return '匿名可用';
}

export function buildLocalStatusResult({
  sourceChecks,
  linuxDoAccess,
  linuxDoLogin
}: {
  sourceChecks: Record<Source, StatusCheck>;
  linuxDoAccess: LinuxDoAccessStatus;
  linuxDoLogin?: LinuxDoLoginStatus;
}) {
  const hasLinuxDoLogin = linuxDoAccess.loggedIn && (!linuxDoLogin || linuxDoLogin.ok || !linuxDoLogin.loginRequired);
  const effectiveLinuxDoAccess = {
    ...linuxDoAccess,
    loggedIn: hasLinuxDoLogin
  };
  const details: HealthDetail[] = STATUS_SOURCES.map((source) => ({
    label: STATUS_LABELS[source],
    ok: sourceChecks[source].ok,
    message: defaultMessage(source, sourceChecks[source])
  }));
  const linuxDoLoginText = linuxDoLogin?.message || linuxDoAccessText(effectiveLinuxDoAccess);
  details.push({
    label: 'linux.do 登录',
    ok: linuxDoLogin ? linuxDoLogin.ok : (effectiveLinuxDoAccess.loggedIn || effectiveLinuxDoAccess.hasClearance || sourceChecks.linuxdo.ok),
    message: linuxDoLoginText
  });

  const sourceStatus = STATUS_SOURCES
    .map((source) => `${STATUS_LABELS[source]} ${sourceChecks[source].ok ? '可用' : '不可用'}`)
    .join(' · ');
  const linuxDoText = effectiveLinuxDoAccess.loggedIn
    ? `linux.do：已登录 ${effectiveLinuxDoAccess.savedAt || ''}`
    : effectiveLinuxDoAccess.hasClearance
      ? `linux.do：已验证 ${effectiveLinuxDoAccess.savedAt || ''}`
      : 'linux.do：匿名可用';

  return {
    details,
    hasLinuxDoClearance: effectiveLinuxDoAccess.hasClearance,
    hasLinuxDoLogin,
    hasYaohuoLogin: sourceChecks.yaohuo.ok,
    summary: `${sourceStatus} · ${linuxDoText}`
  };
}
