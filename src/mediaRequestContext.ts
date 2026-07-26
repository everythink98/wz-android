import { sourceCatalog, sourceValues, type Source } from './sourceCatalog';

export const FORUM_MEDIA_SOURCE_HEADER = 'X-WZ-Forum-Media-Source';

export type ForumMediaRequestContext = Readonly<{
  contentSource: Source | null;
  sessionIdentity: string;
}>;

export function forumMediaSourceHeaderValue(context: ForumMediaRequestContext | null | undefined) {
  return context?.contentSource || 'anonymous';
}

export function forumMediaTargetClass(
  url: string,
  contentSource: Source | null
): 'same-source' | 'cross-source' | 'unmanaged' | 'data' {
  if (/^data:/i.test(url.trim())) {
    return 'data';
  }
  try {
    const host = new URL(url).hostname.toLowerCase();
    const targetSource = sourceValues.find((source) => {
      const sourceHost = new URL(sourceCatalog[source].baseUrl).hostname.toLowerCase();
      return host === sourceHost || host.endsWith(`.${sourceHost}`);
    });
    if (!targetSource) {
      return 'unmanaged';
    }
    return targetSource === contentSource ? 'same-source' : 'cross-source';
  } catch {
    return 'unmanaged';
  }
}
