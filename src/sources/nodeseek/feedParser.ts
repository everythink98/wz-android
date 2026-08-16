import type { Category, NodeSeekFeedFilter, Topic } from '@/domain/forum/models';
import type { NodeSeekSearchFilter } from '@/domain/forum/searchFilters';
import {
  absoluteUrl,
  elementText,
  isRecord,
  parseHtml,
  parsePositiveInteger,
  textExcerpt,
  toIsoString
} from '@/domain/forum/html';
import { accessRequirementFromObject, accessRequirementFromText } from '@/domain/forum/accessRequirements';
import {
  NODESEEK_BASE_URL,
  type NodeSeekPageDocument,
  arrayField,
  isNodeSeekHost,
  nodeSeekAccessRequirementFromListRow,
  nodeSeekCreatedAt,
  nodeSeekEmbeddedReplyCount,
  nodeSeekSpaceUrl,
  parseViewCount,
  safeNodeSeekTopicUrl
} from './protocol';

const BASE_URL = NODESEEK_BASE_URL;

function integerFromElement(element: ReturnType<ReturnType<typeof parseHtml>['querySelector']>) {
  return parsePositiveInteger(elementText(element) || element?.getAttribute('title'));
}

function isInsideFooter(node: ReturnType<ReturnType<typeof parseHtml>['querySelector']>) {
  let current = node?.parentNode as { rawTagName?: string; parentNode?: unknown } | null | undefined;
  while (current) {
    if (String(current.rawTagName || '').toLowerCase() === 'footer') {
      return true;
    }
    current = current.parentNode as typeof current;
  }
  return false;
}

function normalizeTopic(raw: Record<string, unknown>): Topic | null {
  const id = String(raw.postId || raw.id || '').trim();
  const title = String(raw.titleText || raw.title || '').trim();
  if (!id || !title) {
    return null;
  }
  const op = isRecord(raw.op) ? raw.op : {};
  const category = isRecord(raw.category) ? raw.category : isRecord(raw.node) ? raw.node : {};
  const authorId = String(op.userId || op.user_id || op.id || raw.authorId || raw.author_id || '').trim();
  const createdAt = nodeSeekCreatedAt(raw) || new Date().toISOString();
  const lastReplyAt = toIsoString(raw.updatedDate || raw.lastReplyAt) || createdAt;
  const categoryId = typeof category.key === 'string' ? category.key : undefined;
  const categoryName =
    typeof category.name === 'string'
      ? category.name
      : typeof raw.categoryWord === 'string'
        ? raw.categoryWord
        : undefined;
  const accessRequirement = accessRequirementFromObject(raw);
  return {
    source: 'nodeseek',
    id,
    title,
    author: String(op.name || raw.author || ''),
    authorAvatar: absoluteUrl(op.avatar, BASE_URL),
    authorId: authorId || undefined,
    authorUrl: authorId ? nodeSeekSpaceUrl(authorId) : undefined,
    categoryId,
    category: categoryName,
    url: safeNodeSeekTopicUrl(id, raw.titleLink || raw.url),
    createdAt,
    lastReplyAt,
    replyCount: nodeSeekEmbeddedReplyCount(raw),
    viewCount: parseViewCount(raw.views || raw.viewCount),
    excerpt: textExcerpt(raw.content || raw.markdown || ''),
    ...(accessRequirement ? { accessRequirement } : {})
  };
}

export function embeddedTopics(data: Record<string, unknown>) {
  return [...arrayField(data.rotateTopics), ...arrayField(data.topicList), ...arrayField(data.posts)]
    .filter(isRecord)
    .map((topic) => normalizeTopic(topic))
    .filter(Boolean) as Topic[];
}

function nodeSeekSearchTopicUrl(id: string, href: string) {
  try {
    const url = new URL(href, BASE_URL);
    return safeNodeSeekTopicUrl(id, url.searchParams.get('q') || href);
  } catch {
    return safeNodeSeekTopicUrl(id, href);
  }
}

export function parseHtmlTopics(document: NodeSeekPageDocument) {
  const { root } = document;
  const renderedItems: Topic[] = [];
  for (const row of root.querySelectorAll('li.post-list-item')) {
    const link = row.querySelector('.post-title a[href*="post-"]') || row.querySelector('a[href*="post-"]');
    const href = link?.getAttribute('href') || '';
    const id = href.match(/post-(\d+)/)?.[1];
    if (!link || !id) {
      continue;
    }
    const title = elementText(link.querySelector('h3')) || elementText(link);
    if (!title) {
      continue;
    }
    const authorLink = row.querySelector('.info-author a[href*="/space/"]');
    const categoryLink = row.querySelector('a[href*="/categories/"]');
    const categoryHref = categoryLink?.getAttribute('href') || '';
    const categoryId = categoryHref.match(/\/categories\/([^/?#]+)/)?.[1];
    const categoryName = elementText(categoryLink) || undefined;
    const lastReplyTime = row.querySelector('.info-last-comment-time time');
    const lastReplyAt = toIsoString(lastReplyTime?.getAttribute('datetime') || lastReplyTime?.getAttribute('title'));
    const accessRequirement = nodeSeekAccessRequirementFromListRow(row, title);
    renderedItems.push({
      source: 'nodeseek',
      id,
      title,
      author: elementText(authorLink) || String(row.querySelector('img[alt]')?.getAttribute('alt') || ''),
      authorAvatar: absoluteUrl(row.querySelector('img')?.getAttribute('src'), BASE_URL),
      authorId: authorLink?.getAttribute('href')?.match(/\/space\/(\d+)/)?.[1],
      authorUrl: authorLink?.getAttribute('href') ? absoluteUrl(authorLink.getAttribute('href'), BASE_URL) : undefined,
      categoryId,
      category: categoryName,
      url: nodeSeekSearchTopicUrl(id, href),
      createdAt: lastReplyAt || new Date().toISOString(),
      lastReplyAt: lastReplyAt || new Date().toISOString(),
      replyCount: integerFromElement(row.querySelector('.info-comments-count')),
      viewCount: integerFromElement(row.querySelector('.info-views')),
      excerpt: '',
      ...(accessRequirement ? { accessRequirement } : {})
    });
  }
  if (renderedItems.length) {
    return renderedItems;
  }
  const seen = new Set<string>();
  const items: Topic[] = [];
  for (const link of root.querySelectorAll('a[href*="post-"]')) {
    if (isInsideFooter(link)) {
      continue;
    }
    const href = link.getAttribute('href') || '';
    const id = href.match(/post-(\d+)/)?.[1];
    const title = elementText(link.querySelector('h3')) || elementText(link);
    if (!id || !title || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const row = link.parentNode as { text?: string } | null;
    const text = String(row?.text || link.text || '');
    const accessRequirement = accessRequirementFromText(text.replace(title, ' '));
    items.push({
      source: 'nodeseek',
      id,
      title,
      author: '',
      url: nodeSeekSearchTopicUrl(id, href),
      createdAt: new Date().toISOString(),
      lastReplyAt: new Date().toISOString(),
      replyCount: parsePositiveInteger(text.match(/回复\s*(\d+)/)?.[1]),
      excerpt: textExcerpt(text),
      ...(accessRequirement ? { accessRequirement } : {})
    });
  }
  return items;
}

export function parseNodeSeekSearchTopics(document: NodeSeekPageDocument) {
  const { embedded, html, root } = document;
  const renderedItems = parseHtmlTopics(document);
  const hasSearchSurface = Boolean(
    root.querySelector('form[action*="/search"], input[name="q"], .post-list, .empty-state, .notice, .alert')
  );
  const useRenderedSearch = renderedItems.length > 0 || hasSearchSurface;
  const hasPostList = Boolean(root.querySelector('.post-list'));
  const renderedCandidateCount = hasPostList
    ? Math.max(
        root.querySelectorAll('.post-list li.post-list-item').length,
        root.querySelectorAll('.post-list a[href*="post-"]').length
      )
    : renderedItems.length > 0
      ? Math.max(
          (html.match(/<li\b[^>]*\bpost-list-item\b/gi) || []).length,
          (html.match(/<a\b[^>]*href=["'][^"']*post-/gi) || []).length
        )
      : 0;
  const candidateCount = useRenderedSearch
    ? renderedCandidateCount
    : embedded
      ? arrayField(embedded.rotateTopics).length +
        arrayField(embedded.topicList).length +
        arrayField(embedded.posts).length
      : 0;
  const seen = new Set<string>();
  const items = useRenderedSearch ? renderedItems : embedded ? embeddedTopics(embedded) : [];
  return {
    candidateCount,
    items: items.filter((topic) => {
      if (!topic.id || seen.has(topic.id)) {
        return false;
      }
      seen.add(topic.id);
      return true;
    })
  };
}

export function isIncompleteNodeSeekSearchPage(document: NodeSeekPageDocument, items: Topic[]) {
  if (items.length) {
    return false;
  }
  const { root } = document;
  const hasResultSurface = Boolean(root.querySelector('li.post-list-item, .post-list, .empty-state, .notice, .alert'));
  if (hasResultSurface) {
    return false;
  }
  return Boolean(root.querySelector('form[action*="/search"], input[name="q"]'));
}

export function normalizeCategories(data: Record<string, unknown>) {
  return arrayField(data.allCategory)
    .filter(isRecord)
    .flatMap((category) => {
      const id = String(category.key || category.id || '').trim();
      const name = String(category.cn_text || category.name || category.text || '').trim();
      return id && name && !category.adminOnly ? [{ source: 'nodeseek' as const, id, name }] : [];
    });
}

export function mergeNodeSeekCategories(categories: Category[]) {
  const seen = new Set<string>();
  return categories.filter((category) => {
    const key = category.id.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function parseHtmlCategories(document: NodeSeekPageDocument) {
  const { root } = document;
  return mergeNodeSeekCategories(
    root.querySelectorAll('a[href*="/categories/"]').flatMap((link) => {
      const id = link.getAttribute('href')?.match(/\/categories\/([^/?#]+)/)?.[1];
      const name = elementText(link).replace(/^#/, '').trim();
      if (!id || !name) {
        return [];
      }
      try {
        return [{ source: 'nodeseek' as const, id: decodeURIComponent(id), name }];
      } catch {
        return [];
      }
    })
  );
}

export function searchPath(query: string, page = 1, filter?: NodeSeekSearchFilter) {
  const params = new URLSearchParams({ q: query });
  if (filter?.category.trim()) {
    params.set('category', filter.category.trim());
  }
  if (filter?.sort) {
    params.set('sortBy', filter.sort);
  }
  if (page > 1) {
    params.set('page', String(page));
  }
  return `/search?${params.toString()}`;
}

export function nextSearchPath(document: NodeSeekPageDocument, fallbackPage: number) {
  const { root } = document;
  const links = [...root.querySelectorAll('a[rel="next"]'), ...root.querySelectorAll('a[href*="page="]')];
  const href = links
    .map((link) => ({
      href: link.getAttribute('href') || '',
      label: elementText(link),
      rel: String(link.getAttribute('rel') || '')
    }))
    .find(
      (link) =>
        link.href &&
        (/next/i.test(link.rel) || /下一|Next/i.test(link.label) || link.href.includes(`page=${fallbackPage}`))
    )?.href;

  if (!href) {
    return null;
  }

  try {
    const url = new URL(href, BASE_URL);
    if (!isNodeSeekHost(url.hostname) || url.pathname !== '/search') {
      return null;
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

export function listPath(page: number, category?: string, feedFilter: NodeSeekFeedFilter = 'postTime') {
  const prefix = category ? `/categories/${encodeURIComponent(category)}` : '';
  const path = page > 1 ? `${prefix}/page-${page}` : `${prefix || '/'}`;
  return `${path}?sortBy=${feedFilter}`;
}
