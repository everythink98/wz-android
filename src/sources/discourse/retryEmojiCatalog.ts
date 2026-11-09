import { isCanceledRequest } from '@/platform/network/errors';
import { RequestCanceledError } from '@/platform/network/request';
import type { DiscourseEmojiUrlMap } from './reactions';

type EmojiCatalogRetry =
  | { phase: 'reading'; nextDelayMs: number }
  | { phase: 'waiting'; timer: ReturnType<typeof setTimeout>; nextDelayMs: number }
  | { phase: 'settled' };

export function retryEmojiCatalog(read: () => Promise<DiscourseEmojiUrlMap>, signal: AbortSignal) {
  return new Promise<DiscourseEmojiUrlMap>((resolve, reject) => {
    let retry: EmojiCatalogRetry = { phase: 'reading', nextDelayMs: 1_000 };
    const settle = () => {
      const current = retry;
      retry = { phase: 'settled' };
      if (current.phase === 'waiting') clearTimeout(current.timer);
      signal.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      if (retry.phase === 'settled') return;
      settle();
      reject(new RequestCanceledError());
    };
    if (signal.aborted) {
      cancel();
      return;
    }
    signal.addEventListener('abort', cancel, { once: true });
    const attempt = async () => {
      if (retry.phase !== 'reading') return;
      const reading = retry;
      try {
        const urls = await read();
        if (retry !== reading) return;
        settle();
        resolve(urls);
      } catch (error) {
        if (retry !== reading) return;
        if (isCanceledRequest(error)) {
          settle();
          reject(error);
          return;
        }
        const waiting: Extract<EmojiCatalogRetry, { phase: 'waiting' }> = {
          phase: 'waiting',
          nextDelayMs: Math.min(reading.nextDelayMs * 2, 30_000),
          timer: setTimeout(() => {
            if (retry !== waiting) return;
            retry = { phase: 'reading', nextDelayMs: waiting.nextDelayMs };
            void attempt();
          }, reading.nextDelayMs)
        };
        retry = waiting;
      }
    };
    void attempt();
  });
}
