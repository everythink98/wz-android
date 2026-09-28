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
  const staff = currentUser.staff === true || currentUser.admin === true || currentUser.moderator === true;
  const settings =
    site.site_settings && typeof site.site_settings === 'object' ? (site.site_settings as Record<string, unknown>) : {};
  const maximum = Number(settings.poll_maximum_options);
  const minimumTrust = Number(settings.poll_minimum_trust_level_to_create);
  return {
    groups,
    canUseStaffResults: staff,
    ...(Number.isSafeInteger(maximum) && maximum > 0 ? { maxOptions: maximum } : {}),
    ...(typeof settings.poll_default_public === 'boolean' ? { defaultPublic: settings.poll_default_public } : {}),
    ...(Number.isSafeInteger(minimumTrust) && minimumTrust >= 0 ? { minTrust: minimumTrust } : {}),
    ...(typeof currentUser.can_create_poll === 'boolean'
      ? { canCreate: settings.poll_enabled !== false && currentUser.can_create_poll }
      : typeof settings.poll_enabled === 'boolean'
        ? {
            canCreate:
              settings.poll_enabled &&
              (staff || (Number.isFinite(minimumTrust) && Number(currentUser.trust_level) >= minimumTrust))
          }
        : {})
  };
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
