import { RequestCanceledError, withAbortableTimeout } from '@/platform/network/request';
import { getDefaultAndroidWebViewUserAgent } from './androidWebViewUserAgent';

export function resolveWebViewUserAgent(userAgent?: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return Promise.reject(new RequestCanceledError());
  if (userAgent?.trim()) return Promise.resolve(userAgent);
  return withAbortableTimeout(
    (activeSignal) => {
      if (activeSignal.aborted) throw new RequestCanceledError();
      return getDefaultAndroidWebViewUserAgent();
    },
    { signal }
  );
}
