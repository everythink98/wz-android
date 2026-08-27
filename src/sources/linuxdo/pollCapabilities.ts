import type { LinuxDoPollCapabilities } from '@/domain/forum/linuxDoPoll';
import type { Fetcher } from '@/platform/network/request';
import { runLinuxDoAction } from './actionClient';

export function normalizeLinuxDoPollCapabilities(siteValue: unknown, sessionValue: unknown): LinuxDoPollCapabilities {
  const site = siteValue && typeof siteValue === 'object' ? (siteValue as Record<string, unknown>) : {};
  const rows = Array.isArray(site.groups) ? site.groups : [];
  const groups = rows.slice(0, 1000).flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const record = row as Record<string, unknown>;
    const id = Number(record.id);
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const displayName =
      [record.display_name, record.full_name]
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .find((value) => value && value.length <= 100) || name;
    return Number.isSafeInteger(id) && id > 0 && name && name !== 'everyone' && name.length <= 100
      ? [{ id, name, displayName }]
      : [];
  });
  const session = sessionValue && typeof sessionValue === 'object' ? (sessionValue as Record<string, unknown>) : {};
  const currentUser =
    session.current_user && typeof session.current_user === 'object'
      ? (session.current_user as Record<string, unknown>)
      : {};
  return { groups, canUseStaffResults: currentUser.staff === true };
}

export async function fetchLinuxDoPollCapabilities({
  fetcher,
  signal,
  userAgent
}: {
  fetcher: Fetcher;
  signal?: AbortSignal;
  userAgent: string;
}) {
  const [site, session] = await Promise.all(
    ['/site.json', '/session/current.json'].map((path) =>
      runLinuxDoAction({ fetcher, signal, userAgent, request: { path, method: 'GET', headers: {} } })
    )
  );
  return normalizeLinuxDoPollCapabilities(site, session);
}
