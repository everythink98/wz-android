import { LINUXDO_URL } from '@/domain/forum/sourceUrls';
import { cookieNamesFromHeader } from './cookieHeaderNames';
import { managedCookieHeaderOrThrow, readManagedCookieHeader } from './managedCookies';

export type LinuxDoLoginPage = {
  documentKey: string;
  pageStatus: 'logged-in' | 'logged-out' | 'unknown';
  hasChallengeMarker?: boolean;
  hasSessionInitialization?: boolean;
};

export async function waitForLinuxDoLoginInitialization(
  readPage: () => LinuxDoLoginPage | null,
  isCurrent: () => boolean
): Promise<boolean> {
  const deadline = Date.now() + 15_000;
  const timeoutError = new Error('网站登录初始化尚未完成，请稍后重试检测或刷新页面');
  let documentKey: string | undefined;
  while (isCurrent()) {
    if (Date.now() >= deadline) throw timeoutError;
    const page = readPage();
    if (page) {
      if (documentKey && page.documentKey !== documentKey) return false;
      documentKey = page.documentKey;
      if (
        page.hasChallengeMarker === false &&
        (page.pageStatus === 'logged-out' || (page.pageStatus === 'logged-in' && page.hasSessionInitialization))
      ) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let names: string[];
        try {
          const cookies = await Promise.race([
            readManagedCookieHeader(LINUXDO_URL + '/'),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(timeoutError), Math.max(0, deadline - Date.now()));
            })
          ]);
          names = cookieNamesFromHeader(managedCookieHeaderOrThrow(cookies));
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
        if (!isCurrent()) return false;
        // The document can navigate or restart initialization while the native read is pending.
        const current = readPage();
        if (current?.documentKey !== documentKey) return false;
        if (
          current.hasChallengeMarker === false &&
          ((current.pageStatus === 'logged-out' && !names.includes('_t')) ||
            (current.pageStatus === 'logged-in' &&
              current.hasSessionInitialization &&
              names.includes('_t') &&
              names.includes('_rt')))
        )
          return true;
      }
    } else if (documentKey) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  return false;
}
