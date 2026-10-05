import { isCanceledRequest } from '@/platform/network/errors';
import { RequestCanceledError } from '@/platform/network/request';
import type { DiscourseEmojiUrlMap } from './reactions';

export function retryEmojiCatalog(read: () => Promise<DiscourseEmojiUrlMap>, signal: AbortSignal) {
  return new Promise<DiscourseEmojiUrlMap>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 1_000;
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(new RequestCanceledError());
    };
    if (signal.aborted) {
      cancel();
      return;
    }
    signal.addEventListener('abort', cancel, { once: true });
    const attempt = async () => {
      try {
        const urls = await read();
        if (signal.aborted) return;
        signal.removeEventListener('abort', cancel);
        resolve(urls);
      } catch (error) {
        if (signal.aborted) return;
        if (isCanceledRequest(error)) {
          signal.removeEventListener('abort', cancel);
          reject(error);
          return;
        }
        timer = setTimeout(() => void attempt(), delay);
        delay = Math.min(delay * 2, 30_000);
      }
    };
    void attempt();
  });
}
