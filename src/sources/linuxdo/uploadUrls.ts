import type { Fetcher } from '@/platform/network/request';
import { runLinuxDoAction } from './actionClient';

export async function resolveLinuxDoUpload({
  shortUrl,
  fetcher,
  signal,
  userAgent
}: {
  shortUrl: string;
  fetcher: Fetcher;
  signal?: AbortSignal;
  userAgent: string;
}) {
  if (!/^upload:\/\/[a-zA-Z0-9]{1,64}\.[a-zA-Z0-9_-]{1,16}$/.test(shortUrl)) {
    throw new Error('图片短地址不正确');
  }
  // Discourse returns the storage/CDN URL. The short route can require site cookies,
  // which the isolated Composer deliberately does not share with third-party images.
  const data: unknown = await runLinuxDoAction({
    fetcher,
    signal,
    userAgent,
    request: {
      path: '/uploads/lookup-urls',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ short_urls: [shortUrl] })
    }
  });
  const match = Array.isArray(data) && data.find((row) => row?.short_url === shortUrl);
  const url = match && typeof match.url === 'string' ? new URL(match.url, 'https://linux.do') : null;
  if (!url || url.protocol !== 'https:' || url.username || url.password) throw new Error('无法解析图片显示地址');
  return url.href;
}
