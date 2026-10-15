import { decodeHtml, isRecord, parseHtml } from '@/domain/forum/html';
import type { DiscourseInteractionConfig } from '@/domain/forum/discourseInteractions';
import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import { resolveWebViewUserAgent } from '@/platform/android/resolveWebViewUserAgent';
import { isCloudflareChallengeResponse, LinuxDoCloudflareError } from '@/platform/network/cloudflareChallenge';
import { LINUXDO_BASE_URL, linuxDoRequestError } from './protocol';

function record(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return record(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return isRecord(value) ? value : {};
}

export function linuxDoSiteSettingsFromHtml(html: string) {
  const root = parseHtml(html);
  const script = root.querySelector('script#data-preloaded[type="application/json"]');
  const preload = record(
    script?.rawText ?? decodeHtml(root.querySelector('[data-preloaded]')?.getAttribute('data-preloaded') || '')
  );
  return record(preload.siteSettings ?? preload.site_settings);
}

export function linuxDoInteractionConfig(settings: Record<string, unknown>): DiscourseInteractionConfig {
  const reactionsEnabled = settings.discourse_reactions_enabled === true;
  const reactionForLike =
    typeof settings.discourse_reactions_reaction_for_like === 'string'
      ? settings.discourse_reactions_reaction_for_like.trim()
      : 'heart';
  if (!/^[a-z0-9_+-]+$/.test(reactionForLike)) throw new Error('linux.do 默认反应配置不正确');
  const enabledReactions = reactionsEnabled
    ? [
        ...new Set(
          [reactionForLike, ...String(settings.discourse_reactions_enabled_reactions || '').split('|')]
            .map((id) => id.trim())
            .filter((id) => /^[a-z0-9_+-]+$/.test(id))
        )
      ]
    : [];
  const maxBoosts = Number(settings.discourse_boosts_max_per_post);
  return {
    reactionsEnabled,
    enabledReactions,
    reactionForLike,
    boostsEnabled: settings.discourse_boosts_enabled === true,
    maxBoostsPerPost: Number.isSafeInteger(maxBoosts) && maxBoosts > 0 && maxBoosts <= 200 ? maxBoosts : 50
  };
}

export async function loadLinuxDoInteractionConfig({
  fetcher,
  signal,
  userAgent,
  timeoutMs
}: {
  fetcher: Fetcher;
  signal?: AbortSignal;
  userAgent?: string;
  timeoutMs?: number;
}) {
  const response = await fetchWithTimeout(
    `${LINUXDO_BASE_URL}/latest`,
    {
      headers: { Accept: 'text/html', 'User-Agent': await resolveWebViewUserAgent(userAgent, signal) }
    },
    { fetcher, signal, timeoutMs }
  );
  const html = await response.text();
  const settings = linuxDoSiteSettingsFromHtml(html);
  if (
    isCloudflareChallengeResponse(response) ||
    (!Object.keys(settings).length &&
      isCloudflareChallengeResponse({
        status: response.status,
        headers: response.headers,
        bodyText: html
      }))
  )
    throw new LinuxDoCloudflareError(response);
  if (!response.ok) throw linuxDoRequestError(`linux.do 互动配置读取失败：HTTP ${response.status}`, response.status);
  if (!Object.keys(settings).length) throw new Error('linux.do 未返回互动配置，请刷新后重试');
  return linuxDoInteractionConfig(settings);
}
