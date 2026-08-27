import type { Source } from './models';

export type ExternalForumSearchSource = Extract<Source, 'linuxdo' | 'nodeseek'>;

const externalSearchSites: Record<ExternalForumSearchSource, string> = {
  linuxdo: 'linux.do',
  nodeseek: 'nodeseek.com'
};

export function isExternalForumSearchSource(source: Source): source is ExternalForumSearchSource {
  return source === 'linuxdo' || source === 'nodeseek';
}

export function buildExternalForumSearchUrl(source: ExternalForumSearchSource, query: string) {
  const params = new URLSearchParams({ q: `site:${externalSearchSites[source]} ${query.trim()}` });
  return `https://www.google.com/search?${params.toString()}`;
}

export function isExternalForumSearchUrl(input: string) {
  try {
    const url = new URL(input);
    const query = url.searchParams.get('q') || '';
    const scopedQuery = ['site:linux.do ', 'site:nodeseek.com '].some(
      (prefix) => query.startsWith(prefix) && Boolean(query.slice(prefix.length).trim())
    );
    return (
      url.protocol === 'https:' &&
      url.hostname === 'www.google.com' &&
      url.port === '' &&
      !url.username &&
      !url.password &&
      url.pathname === '/search' &&
      !url.hash &&
      [...url.searchParams.keys()].length === 1 &&
      scopedQuery
    );
  } catch {
    return false;
  }
}
