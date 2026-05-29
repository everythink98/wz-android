import MarkdownIt from 'markdown-it';
import { Buffer } from 'buffer';
import type { HTMLElement } from 'node-html-parser';
import { fetchWithTimeout, type Fetcher } from './request';
import { DEFAULT_NODESEEK_ANDROID_USER_AGENT } from './nodeseekCookies';
import type { Category, FeedResponse, RepliesResponse, SearchResponse, Topic, TopicDetail, UserProfile } from './types';
import {
  absoluteUrl,
  accessRequirementFromObject,
  accessRequirementFromText,
  elementText,
  isRecord,
  parseHtml,
  parsePositiveInteger,
  sanitizeContentHtml,
  sortTopicsByTime,
  textExcerpt,
  toIsoString
} from './localHtml';
import { matchesSearchExpression, parseSearchExpression, searchExpressionText } from './feedLogic';

const BASE_URL = 'https://www.nodeseek.com';
const MAX_NODESEEK_SEARCH_PAGES = 5;
export const NODESEEK_CLOUDFLARE_MESSAGE = 'NodeSeek 需要完成 Cloudflare 验证';
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

interface NodeSeekOptions {
  fetcher?: Fetcher;
  nodeSeekCookie?: string;
  nodeSeekUserAgent?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function markdownToHtml(markdown: unknown) {
  return sanitizeContentHtml(md.render(String(markdown || '')), BASE_URL);
}

function topicUrl(id: string) {
  return `${BASE_URL}/post-${id}-1`;
}

function spaceUrl(id: string) {
  return `${BASE_URL}/space/${encodeURIComponent(id)}`;
}

function topicPagePath(id: string, page: number) {
  return `/post-${encodeURIComponent(id)}-${page}`;
}

function nodeSeekPostPageFromHref(href: string | undefined, id: string) {
  if (!href) {
    return null;
  }
  try {
    const pathname = new URL(href, BASE_URL).pathname;
    const prefix = `/post-${encodeURIComponent(id)}-`;
    if (!pathname.startsWith(prefix)) {
      return null;
    }
    return parsePositiveInteger(pathname.slice(prefix.length));
  } catch {
    return null;
  }
}

function nextNodeSeekPostPage(html: string, id: string, currentPage = 1) {
  let nextPage: number | null = null;
  for (const link of parseHtml(html).querySelectorAll('a')) {
    const page = nodeSeekPostPageFromHref(link.getAttribute('href'), id);
    if (page && page > currentPage && (!nextPage || page < nextPage)) {
      nextPage = page;
    }
  }
  return nextPage;
}

function nextNodeSeekListPage(html: string, currentPage = 1) {
  let nextPage: number | null = null;
  for (const link of parseHtml(html).querySelectorAll('a[href]')) {
    try {
      const pathname = new URL(link.getAttribute('href') || '', BASE_URL).pathname;
      const page = parsePositiveInteger(pathname.match(/(?:^|\/)page-(\d+)$/)?.[1]);
      if (page && page > currentPage && (!nextPage || page < nextPage)) {
        nextPage = page;
      }
    } catch {
      // Ignore unrelated links.
    }
  }
  return nextPage;
}

function withNodeSeekReplyPagination(topic: TopicDetail, html: string, id: string, currentPage = 1) {
  const nextPage = nextNodeSeekPostPage(html, id, currentPage);
  if (!topic.replyHasMore && nextPage) {
    return {
      ...topic,
      replyHasMore: true,
      replyNextPage: nextPage,
      replyNextOffset: topic.replies.length
    };
  }
  return topic;
}

function isNodeSeekHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === 'nodeseek.com' || host.endsWith('.nodeseek.com');
}

function safeNodeSeekTopicUrl(id: string, rawUrl?: unknown) {
  const fallback = topicUrl(id);
  const next = absoluteUrl(rawUrl, BASE_URL) || fallback;
  try {
    return isNodeSeekHost(new URL(next).hostname) ? next : fallback;
  } catch {
    return fallback;
  }
}

function parseViewCount(value: unknown) {
  const match = String(value || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(万|千|w|k|m)?/i);
  if (!match) {
    return undefined;
  }
  const number = Number(match[1]);
  const suffix = match[2]?.toLowerCase();
  const multiplier = suffix === '万' || suffix === 'w'
    ? 10000
    : suffix === '千' || suffix === 'k'
      ? 1000
      : suffix === 'm'
        ? 1000000
        : 1;
  const count = Math.round(number * multiplier);
  return count || undefined;
}

function optionalInteger(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const match = String(value).replace(/,/g, '').match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function optionalBoolean(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no'].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

function nodeSeekEmbeddedUserId(user: Record<string, unknown>) {
  return String(user.uid || user.id || user.userId || user.user_id || user.member_id || '').trim();
}

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

function embeddedCandidates(html: string) {
  const scriptContents = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  const dataAttributes = [...html.matchAll(/\sdata-[\w:-]+=["']([^"']*eyJ[A-Za-z0-9+/=]{40,}[^"']*)["']/g)].map((match) => match[1]);
  return [...scriptContents, ...dataAttributes].flatMap((content) => content.match(/eyJ[A-Za-z0-9+/=]{40,}/g) || []);
}

export function extractNodeSeekEmbeddedData(html: string) {
  for (const candidate of embeddedCandidates(html)) {
    try {
      const parsed = JSON.parse(Buffer.from(candidate, 'base64').toString('utf8'));
      if (isRecord(parsed) && (parsed.postData || parsed.rotateTopics || parsed.topicList || parsed.allCategory || parsed.posts)) {
        return parsed;
      }
    } catch {
      // Continue scanning unrelated base64 strings.
    }
  }
  return null;
}

function arrayField(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function nodeSeekCreatedAt(raw: Record<string, unknown>) {
  const time = isRecord(raw.time) ? raw.time : {};
  return toIsoString(raw.created_at || raw.createdAt || raw.createdDate || time.created_at || time.createdAt || time.createdDate || raw.time);
}

function nodeSeekEmbeddedReplyCount(raw: Record<string, unknown>) {
  const explicitReplyCount = raw.replyCount ?? raw.replies ?? raw.reply_count;
  if (explicitReplyCount !== undefined && explicitReplyCount !== null && explicitReplyCount !== '') {
    return parsePositiveInteger(explicitReplyCount);
  }
  return Math.max(parsePositiveInteger(raw.comments ?? raw.commentCount ?? raw.comment_count) - 1, 0);
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
  const accessRequirement = accessRequirementFromObject(raw);
  return {
    source: 'nodeseek',
    id,
    title,
    author: String(op.name || raw.author || ''),
    authorAvatar: absoluteUrl(op.avatar, BASE_URL),
    authorId: authorId || undefined,
    authorUrl: authorId ? spaceUrl(authorId) : undefined,
    categoryId: typeof category.key === 'string' ? category.key : undefined,
    category: typeof category.name === 'string' ? category.name : typeof raw.categoryWord === 'string' ? raw.categoryWord : undefined,
    url: safeNodeSeekTopicUrl(id, raw.titleLink || raw.url),
    createdAt,
    lastReplyAt,
    replyCount: nodeSeekEmbeddedReplyCount(raw),
    viewCount: parseViewCount(raw.views || raw.viewCount),
    excerpt: textExcerpt(raw.content || raw.markdown || ''),
    ...(accessRequirement ? { accessRequirement } : {})
  };
}

function sortNodeSeekUserTopics(topics: Topic[]) {
  return topics
    .map((topic, index) => ({ topic, index, time: Date.parse(topic.createdAt || '') }))
    .sort((left, right) => {
      const leftTimed = Number.isFinite(left.time);
      const rightTimed = Number.isFinite(right.time);
      if (leftTimed && rightTimed) {
        return right.time - left.time;
      }
      if (leftTimed !== rightTimed) {
        return leftTimed ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map((item) => item.topic);
}

function embeddedTopics(data: Record<string, unknown>) {
  return [
    ...arrayField(data.rotateTopics),
    ...arrayField(data.topicList),
    ...arrayField(data.posts)
  ].filter(isRecord).map(normalizeTopic).filter(Boolean) as Topic[];
}

function parseHtmlTopics(html: string) {
  const root = parseHtml(html);
  const renderedItems: Topic[] = [];
  for (const row of root.querySelectorAll('li.post-list-item')) {
    const link = row.querySelector('.post-title a[href*="post-"]') || row.querySelector('a[href*="post-"]');
    const href = link?.getAttribute('href') || '';
    const id = href.match(/post-(\d+)/)?.[1];
    const title = elementText(link);
    if (!id || !title) {
      continue;
    }
    const authorLink = row.querySelector('.info-author a[href*="/space/"]');
    const categoryLink = row.querySelector('a[href*="/categories/"]');
    const categoryHref = categoryLink?.getAttribute('href') || '';
    const lastReplyTime = row.querySelector('.info-last-comment-time time');
    const lastReplyAt = toIsoString(lastReplyTime?.getAttribute('datetime') || lastReplyTime?.getAttribute('title'));
    const accessRequirement = accessRequirementFromText(elementText(row).replace(title, ' '));
    renderedItems.push({
      source: 'nodeseek',
      id,
      title,
      author: elementText(authorLink) || String(row.querySelector('img[alt]')?.getAttribute('alt') || ''),
      authorAvatar: absoluteUrl(row.querySelector('img')?.getAttribute('src'), BASE_URL),
      authorId: authorLink?.getAttribute('href')?.match(/\/space\/(\d+)/)?.[1],
      authorUrl: authorLink?.getAttribute('href') ? absoluteUrl(authorLink.getAttribute('href'), BASE_URL) : undefined,
      categoryId: categoryHref.match(/\/categories\/([^/?#]+)/)?.[1],
      category: elementText(categoryLink) || undefined,
      url: safeNodeSeekTopicUrl(id, href),
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
    const title = elementText(link);
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
      url: safeNodeSeekTopicUrl(id, href),
      createdAt: new Date().toISOString(),
      lastReplyAt: new Date().toISOString(),
      replyCount: parsePositiveInteger(text.match(/回复\s*(\d+)/)?.[1]),
      excerpt: textExcerpt(text),
      ...(accessRequirement ? { accessRequirement } : {})
    });
  }
  return items;
}

function parseNodeSeekSearchTopics(html: string) {
  const embedded = extractNodeSeekEmbeddedData(html);
  const seen = new Set<string>();
  return [
    ...(embedded ? embeddedTopics(embedded) : []),
    ...parseHtmlTopics(html)
  ].filter((topic) => {
    if (!topic.id || seen.has(topic.id)) {
      return false;
    }
    seen.add(topic.id);
    return true;
  });
}

function normalizeCategories(data: Record<string, unknown>) {
  return arrayField(data.allCategory).filter(isRecord).flatMap((category) => {
    const id = String(category.key || category.id || '').trim();
    const name = String(category.cn_text || category.name || category.text || '').trim();
    return id && name && !category.adminOnly ? [{ source: 'nodeseek' as const, id, name }] : [];
  });
}

function mergeNodeSeekCategories(categories: Category[]) {
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

function parseHtmlCategories(html: string) {
  const root = parseHtml(html);
  return mergeNodeSeekCategories(root.querySelectorAll('a[href*="/categories/"]').flatMap((link) => {
    const id = link.getAttribute('href')?.match(/\/categories\/([^/?#]+)/)?.[1];
    const name = elementText(link).replace(/^#/, '').trim();
    if (!id || !name) {
      return [];
    }
    return [{ source: 'nodeseek' as const, id: decodeURIComponent(id), name }];
  }));
}

function isNodeSeekCloudflareResponse(response: Response, html: string) {
  return response.headers.get('cf-mitigated') === 'challenge'
    || /cf-turnstile|challenge-platform/i.test(html)
    || /<title>\s*(?:just a moment|请稍候)/i.test(html)
    || /正在进行安全验证|安全服务防护恶意自动程序/i.test(html)
    || (response.status === 403 && /just a moment|cloudflare|请稍候/i.test(html));
}

function nodeSeekCloudflareError() {
  return Object.assign(new Error(NODESEEK_CLOUDFLARE_MESSAGE), {
    source: 'nodeseek',
    reason: 'cloudflare'
  });
}

function isNodeSeekCloudflareError(error: unknown) {
  return isRecord(error) && error.reason === 'cloudflare';
}

async function fetchNodeSeekText(path: string, options: NodeSeekOptions = {}) {
  const cookie = options.nodeSeekCookie?.trim();
  const headers: HeadersInit = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.7',
    Referer: BASE_URL,
    'User-Agent': options.nodeSeekUserAgent || DEFAULT_NODESEEK_ANDROID_USER_AGENT
  };
  if (cookie) {
    headers.cookie = cookie;
  }
  const response = await fetchWithTimeout(`${BASE_URL}${path}`, {
    headers
  }, options);
  const text = await response.text();
  if (isNodeSeekCloudflareResponse(response, text)) {
    throw nodeSeekCloudflareError();
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return text;
}

async function fetchNodeSeekJson(path: string, options: NodeSeekOptions = {}) {
  const text = await fetchNodeSeekText(path, options);
  try {
    return JSON.parse(extractNodeSeekJsonText(text)) as unknown;
  } catch {
    throw new Error('NodeSeek 数据解析失败');
  }
}

function extractNodeSeekJsonText(text: string) {
  const trimmed = text.trim();
  if (!/^</.test(trimmed)) {
    return trimmed;
  }
  const root = parseHtml(trimmed);
  const preText = elementText(root.querySelector('pre')).trim();
  if (preText) {
    return preText;
  }
  return elementText(root.querySelector('body')).trim() || trimmed;
}

function searchPath(query: string, page = 1) {
  const params = new URLSearchParams({ q: query });
  if (page > 1) {
    params.set('page', String(page));
  }
  return `/search?${params.toString()}`;
}

function nextSearchPath(html: string, fallbackPage: number) {
  const root = parseHtml(html);
  const links = [
    ...root.querySelectorAll('a[rel="next"]'),
    ...root.querySelectorAll('a[href*="page="]')
  ];
  const href = links
    .map((link) => ({
      href: link.getAttribute('href') || '',
      label: elementText(link),
      rel: String(link.getAttribute('rel') || '')
    }))
    .find((link) => (
      link.href
      && (
        /next/i.test(link.rel)
        || /下一|Next/i.test(link.label)
        || link.href.includes(`page=${fallbackPage}`)
      )
    ))?.href;

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

function mergeSearchTopics(existing: Topic[], incoming: Topic[]) {
  const seen = new Set(existing.map((topic) => topic.id));
  const next = [...existing];
  for (const topic of incoming) {
    if (!topic.id || seen.has(topic.id)) {
      continue;
    }
    seen.add(topic.id);
    next.push(topic);
  }
  return next;
}

function filterNodeSeekSearchTopics(html: string, query: string) {
  const expression = parseSearchExpression(query);
  return parseNodeSeekSearchTopics(html)
    .filter((topic) => matchesSearchExpression(searchExpressionText(topic), expression));
}

function listPath(page: number, category?: string) {
  const prefix = category ? `/categories/${encodeURIComponent(category)}` : '';
  const path = page > 1 ? `${prefix}/page-${page}` : `${prefix || '/'}`;
  return `${path}?sortBy=postTime`;
}

export async function getNodeSeekFeed(options: NodeSeekOptions & {
  page?: number;
  limit?: number;
  category?: string;
} = {}): Promise<FeedResponse> {
  const page = options.page || 1;
  const limit = options.limit || 30;
  const html = await fetchNodeSeekText(listPath(page, options.category), options);
  const embedded = extractNodeSeekEmbeddedData(html);
  const items = embedded ? embeddedTopics(embedded) : parseHtmlTopics(html);
  const filtered = options.category
    ? items.filter((item) => !item.categoryId || item.categoryId === options.category || item.category === options.category)
    : items;
  const nextPage = nextNodeSeekListPage(html, page);
  const hasMore = Boolean(nextPage);
  return {
    items: filtered.slice(0, limit),
    errors: {},
    hasMore,
    nextPage: nextPage || null
  };
}

export async function getNodeSeekCategories(options: NodeSeekOptions = {}) {
  const html = await fetchNodeSeekText('/', options);
  const embedded = extractNodeSeekEmbeddedData(html);
  return {
    items: mergeNodeSeekCategories([
      ...(embedded ? normalizeCategories(embedded) : [] as Category[]),
      ...parseHtmlCategories(html)
    ]),
    errors: {}
  };
}

function normalizeReplies(comments: unknown[], { skipFirst, start = 0, floorOffset = 0 }: { skipFirst: boolean; start?: number; floorOffset?: number }) {
  const source = skipFirst ? comments.slice(1) : comments;
  return source.slice(start).filter(isRecord).map((comment, index) => {
    const poster = isRecord(comment.poster) ? comment.poster : {};
    const authorId = nodeSeekEmbeddedUserId(poster);
    const authorUrl = absoluteUrl(poster.profile, BASE_URL) || (authorId ? spaceUrl(authorId) : undefined);
    const signatureHtml = String(comment.signature || '').trim()
      ? markdownToHtml(comment.signature)
      : undefined;
    const floorIndex = optionalInteger(comment.floorIndex ?? comment.floor);
    return {
      author: String(poster.name || ''),
      authorAvatar: absoluteUrl(poster.avatar, BASE_URL),
      authorId: authorId || undefined,
      authorUrl,
      contentHtml: markdownToHtml(comment.markdown),
      createdAt: toIsoString(isRecord(comment.time) ? comment.time.createdDate : comment.createdDate),
      floor: floorIndex ?? floorOffset + start + index + 1,
      commentId: optionalInteger(comment.commentId),
      upvoteCount: optionalInteger(comment.upvoteCount),
      likeCount: optionalInteger(comment.likeCount),
      dislikeCount: optionalInteger(comment.dislikeCount),
      upvoted: optionalBoolean(comment.upvoted),
      liked: optionalBoolean(comment.liked),
      disliked: optionalBoolean(comment.disliked),
      isOp: poster.isOp === true || String(poster.info || '').trim() === '楼主' || undefined,
      hot: comment.hot === true || undefined,
      pinned: comment.pined === true || comment.pinned === true || undefined,
      signatureHtml
    };
  });
}

function normalizePostData(data: Record<string, unknown>, id: string, url: string, replyLimit = 30): TopicDetail {
  const comments = arrayField(data.comments);
  const first = isRecord(comments[0]) ? comments[0] : {};
  const op = isRecord(data.op) ? data.op : {};
  const poster = isRecord(first.poster) ? first.poster : {};
  const category = isRecord(data.category) ? data.category : isRecord(data.node) ? data.node : {};
  const categoryLink = String(data.categoryLink || '');
  const categoryId = typeof category.key === 'string'
    ? category.key
    : typeof data.category === 'string'
      ? data.category
      : categoryLink.match(/\/categories\/([^/?#]+)/)?.[1];
  const categoryName = typeof category.name === 'string'
    ? category.name
    : typeof data.categoryWord === 'string'
      ? data.categoryWord
      : undefined;
  const allReplies = normalizeReplies(comments, { skipFirst: true });
  const replies = allReplies.slice(0, replyLimit);
  const createdAt = toIsoString(isRecord(first.time) ? first.time.createdDate : data.createdDate) || new Date().toISOString();
  const lastComment = comments.at(-1);
  let lastCommentDate: unknown;
  if (isRecord(lastComment)) {
    lastCommentDate = isRecord(lastComment.time) ? lastComment.time.createdDate : lastComment.createdDate;
  }
  const lastReplyAt = toIsoString(lastCommentDate || data.updatedDate) || createdAt;
  const accessRequirement = accessRequirementFromObject(data);
  const authorId = nodeSeekEmbeddedUserId(op) || nodeSeekEmbeddedUserId(poster);
  const authorUrl = absoluteUrl(op.profile || poster.profile, BASE_URL) || (authorId ? spaceUrl(authorId) : undefined);
  return {
    source: 'nodeseek',
    id,
    title: String(data.title || ''),
    author: String(op.name || poster.name || ''),
    authorAvatar: absoluteUrl(op.avatar || poster.avatar, BASE_URL),
    authorId: authorId || undefined,
    authorUrl,
    categoryId,
    category: categoryName,
    url,
    createdAt,
    lastReplyAt,
    replyCount: allReplies.length,
    viewCount: parseViewCount(data.views),
    excerpt: textExcerpt(first.markdown),
    contentHtml: markdownToHtml(first.markdown),
    commentId: optionalInteger(first.commentId),
    upvoteCount: optionalInteger(first.upvoteCount),
    likeCount: optionalInteger(first.likeCount),
    dislikeCount: optionalInteger(first.dislikeCount),
    upvoted: optionalBoolean(first.upvoted),
    liked: optionalBoolean(first.liked),
    disliked: optionalBoolean(first.disliked),
    collectionCount: optionalInteger(data.collectionCount),
    collected: optionalBoolean(data.collected),
    locked: optionalBoolean(data.locked),
    ...(accessRequirement ? { accessRequirement } : {}),
    replies,
    replyHasMore: allReplies.length > replyLimit,
    replyNextPage: allReplies.length > replyLimit ? 1 : null,
    replyNextOffset: allReplies.length > replyLimit ? replies.length : null
  };
}

function renderedNodeSeekTime(element: ReturnType<ReturnType<typeof parseHtml>['querySelector']>) {
  return toIsoString(element?.getAttribute('datetime') || element?.getAttribute('title') || elementText(element));
}

function renderedNodeSeekCommentId(element: ReturnType<ReturnType<typeof parseHtml>['querySelectorAll']>[number]) {
  const dataCommentId = parsePositiveInteger(element.getAttribute('data-comment-id'));
  if (dataCommentId) {
    return dataCommentId;
  }
  const source = `${element.getAttribute('id') || ''}`;
  const match = source.match(/comment[-_]?(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

function renderedNodeSeekAuthor(element: HTMLElement | null | undefined) {
  if (!element) {
    return '';
  }
  return elementText(element.querySelector('.author-name'))
    || elementText(element.querySelector('.comment-author'))
    || elementText(element.querySelector('.reply-author'))
    || element.querySelectorAll('a[href*="/space/"]').map((link) => elementText(link)).find(Boolean)
    || '';
}

function renderedNodeSeekAvatar(element: HTMLElement | null | undefined) {
  if (!element) {
    return undefined;
  }
  return absoluteUrl(
    element.querySelector('.author-info a[href*="/space/"] img, .post-info a[href*="/space/"] img, .comment-author img, .reply-author img, a[href*="/space/"] img, img.avatar')?.getAttribute('src'),
    BASE_URL
  );
}

function renderedNodeSeekFloor(element: ReturnType<ReturnType<typeof parseHtml>['querySelectorAll']>[number], fallback: number) {
  const linkFloor = parsePositiveInteger(elementText(element.querySelector('.floor-link')));
  if (linkFloor) {
    return linkFloor;
  }
  const id = String(element.getAttribute('id') || '');
  return /^\d+$/.test(id) ? Number(id) : fallback;
}

function renderedNodeSeekReactionItem(element: HTMLElement | null | undefined, keywords: string[]) {
  if (!element) {
    return null;
  }
  return element.querySelectorAll('.comment-menu .menu-item').find((item) => {
    const haystack = [
      item.getAttribute('title'),
      item.getAttribute('aria-label'),
      item.getAttribute('class'),
      item.innerHTML
    ].join(' ').toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
  }) || null;
}

function renderedNodeSeekReactionCount(element: HTMLElement | null | undefined, keywords: string[]) {
  const item = renderedNodeSeekReactionItem(element, keywords);
  if (!item) {
    return undefined;
  }
  return optionalInteger(
    elementText(item.querySelector('span'))
    || item.getAttribute('data-count')
    || item.getAttribute('title')
    || elementText(item)
  );
}

function renderedNodeSeekReactionClicked(element: HTMLElement | null | undefined, keywords: string[]) {
  const item = renderedNodeSeekReactionItem(element, keywords);
  return item ? String(item.getAttribute('class') || '').split(/\s+/).includes('clicked') || undefined : undefined;
}

function renderedNodeSeekSignature(element: HTMLElement | null | undefined) {
  const signature = element?.querySelector('.signature, .post-signature, .content-signature');
  return signature?.innerHTML ? sanitizeContentHtml(signature.innerHTML, BASE_URL) : undefined;
}

function renderedNodeSeekIsOp(element: HTMLElement | null | undefined) {
  return Boolean(element?.querySelector('.is-poster, .poster-badge') || elementText(element?.querySelector('.role-tag')).trim() === '楼主') || undefined;
}

function parseRenderedNodeSeekTopicHtml(html: string, id: string, replyLimit = 30): TopicDetail | null {
  const root = parseHtml(html);
  const firstContentItem = root.querySelector('.content-item');
  const titleElement = root.querySelector('.post-title a')
    || root.querySelector('a.post-title')
    || root.querySelector('article .post-title')
    || root.querySelector('.post-detail .post-title')
    || root.querySelector('.post-title')
    || root.querySelector('h1');
  const contentElement = firstContentItem?.querySelector('.post-content')
    || root.querySelector('article .post-content')
    || root.querySelector('.post-detail .post-content')
    || root.querySelector('.post-content')
    || root.querySelector('.content');
  const title = elementText(titleElement);
  const contentHtml = contentElement?.innerHTML || '';
  if (!title || !contentHtml) {
    return null;
  }
  const authorContainer = firstContentItem || root.querySelector('article') || root.querySelector('.post-detail') || root;
  const categoryLink = firstContentItem?.querySelector('.content-category a[href*="/categories/"], a[href*="/categories/"]')
    || root.querySelector('article a[href*="/categories/"]')
    || root.querySelector('.post-detail a[href*="/categories/"]')
    || root.querySelector('.post-info a[href*="/categories/"]')
    || root.querySelector('a[href*="/categories/"]');
  const categoryHref = categoryLink?.getAttribute('href') || '';
  const createdAt = renderedNodeSeekTime(firstContentItem?.querySelector('time') || root.querySelector('article time') || root.querySelector('.post-detail time') || root.querySelector('time')) || new Date().toISOString();
  const replyRows = root.querySelectorAll('.content-item, .comment-item, .comment-list > li, .comments > li, [id^="comment-"]').filter((row) => {
    const replyContent = row.querySelector('.post-content, .comment-content, .reply-content, .content');
    return Boolean(replyContent?.innerHTML && row !== firstContentItem);
  });
  const allReplies = replyRows.map((row, index) => {
    const replyContent = row.querySelector('.post-content, .comment-content, .reply-content, .content');
    const authorHref = row.querySelector('a[href*="/space/"]')?.getAttribute('href') || '';
    const authorId = authorHref.match(/\/space\/(\d+)/)?.[1];
    return {
      author: renderedNodeSeekAuthor(row),
      authorAvatar: renderedNodeSeekAvatar(row),
      authorId,
      authorUrl: authorHref ? absoluteUrl(authorHref, BASE_URL) : undefined,
      contentHtml: sanitizeContentHtml(replyContent?.innerHTML || '', BASE_URL),
      createdAt: renderedNodeSeekTime(row.querySelector('time')) || createdAt,
      floor: renderedNodeSeekFloor(row, index + 1),
      commentId: renderedNodeSeekCommentId(row),
      upvoteCount: renderedNodeSeekReactionCount(row, ['点赞', 'good-one', 'upvote']),
      likeCount: renderedNodeSeekReactionCount(row, ['加鸡腿', 'chicken-leg']),
      dislikeCount: renderedNodeSeekReactionCount(row, ['反对', 'bad-one', 'oppose', 'dislike']),
      upvoted: renderedNodeSeekReactionClicked(row, ['点赞', 'good-one', 'upvote']),
      liked: renderedNodeSeekReactionClicked(row, ['加鸡腿', 'chicken-leg']),
      disliked: renderedNodeSeekReactionClicked(row, ['反对', 'bad-one', 'oppose', 'dislike']),
      isOp: renderedNodeSeekIsOp(row),
      hot: Boolean(row.querySelector('.hot-badge')) || undefined,
      pinned: Boolean(row.querySelector('.pined-badge, .pinned-badge, .pin-badge')) || undefined,
      signatureHtml: renderedNodeSeekSignature(row)
    };
  });
  const replies = allReplies.slice(0, replyLimit);
  const lastReplyAt = allReplies.at(-1)?.createdAt || createdAt;
  const authorHref = authorContainer?.querySelector('a[href*="/space/"]')?.getAttribute('href') || '';
  const authorId = authorHref.match(/\/space\/(\d+)/)?.[1];
  return {
    source: 'nodeseek',
    id,
    title,
    author: renderedNodeSeekAuthor(authorContainer),
    authorAvatar: renderedNodeSeekAvatar(authorContainer),
    authorId,
    authorUrl: authorHref ? absoluteUrl(authorHref, BASE_URL) : undefined,
    categoryId: categoryHref.match(/\/categories\/([^/?#]+)/)?.[1],
    category: elementText(categoryLink) || undefined,
    url: topicUrl(id),
    createdAt,
    lastReplyAt,
    replyCount: allReplies.length,
    excerpt: textExcerpt(contentHtml),
    contentHtml: sanitizeContentHtml(contentHtml, BASE_URL),
    commentId: firstContentItem ? renderedNodeSeekCommentId(firstContentItem) : undefined,
    upvoteCount: renderedNodeSeekReactionCount(firstContentItem, ['点赞', 'good-one', 'upvote']),
    likeCount: renderedNodeSeekReactionCount(firstContentItem, ['加鸡腿', 'chicken-leg']),
    dislikeCount: renderedNodeSeekReactionCount(firstContentItem, ['反对', 'bad-one', 'oppose', 'dislike']),
    upvoted: renderedNodeSeekReactionClicked(firstContentItem, ['点赞', 'good-one', 'upvote']),
    liked: renderedNodeSeekReactionClicked(firstContentItem, ['加鸡腿', 'chicken-leg']),
    disliked: renderedNodeSeekReactionClicked(firstContentItem, ['反对', 'bad-one', 'oppose', 'dislike']),
    collectionCount: renderedNodeSeekReactionCount(firstContentItem, ['收藏', 'star', 'favorite', 'collect', 'bookmark']),
    replies,
    replyHasMore: allReplies.length > replyLimit,
    replyNextPage: allReplies.length > replyLimit ? 1 : null,
    replyNextOffset: allReplies.length > replyLimit ? replies.length : null
  };
}

async function fetchTopicHtml(id: string, page: number, options: NodeSeekOptions) {
  return fetchNodeSeekText(topicPagePath(id, page), options);
}

async function fetchTopicPageData(id: string, page: number, options: NodeSeekOptions) {
  const html = await fetchTopicHtml(id, page, options);
  const embedded = extractNodeSeekEmbeddedData(html);
  const postData = embedded && isRecord(embedded.postData) ? embedded.postData : null;
  const rendered = postData ? null : parseRenderedNodeSeekTopicHtml(html, id, Number.MAX_SAFE_INTEGER);
  if (!postData && !rendered) {
    throw new Error('NodeSeek 主题解析失败');
  }
  return { html, postData, rendered };
}

export async function getNodeSeekTopic(id: string, options: NodeSeekOptions & { replyLimit?: number } = {}) {
  const html = await fetchTopicHtml(id, 1, options);
  const embedded = extractNodeSeekEmbeddedData(html);
  const postData = embedded && isRecord(embedded.postData) ? embedded.postData : null;
  if (postData) {
    return withNodeSeekReplyPagination(normalizePostData(postData, id, topicUrl(id), options.replyLimit || 30), html, id, 1);
  }
  const rendered = parseRenderedNodeSeekTopicHtml(html, id, options.replyLimit || 30);
  if (rendered) {
    return withNodeSeekReplyPagination(rendered, html, id, 1);
  }
  throw new Error('NodeSeek 主题解析失败');
}

export async function getNodeSeekReplies(id: string, options: NodeSeekOptions & {
  page?: number;
  limit?: number;
  offset?: number | null;
}): Promise<RepliesResponse> {
  const page = options.page || 1;
  const limit = options.limit || 30;
  const { html, postData, rendered } = await fetchTopicPageData(id, page, options);
  const hasOffset = typeof options.offset === 'number' && options.offset >= 0;
  const offset = hasOffset ? options.offset as number : 0;
  if (rendered) {
    const source = page <= 1 ? rendered.replies : rendered.replies.map((reply, index) => ({
      ...reply,
      floor: reply.floor ?? (hasOffset ? offset + index + 1 : ((page - 1) * limit) + index + 1)
    }));
    const items = page <= 1 ? source.slice(offset, offset + limit) : source;
    const consumed = offset + items.length;
    const hasPageRemainder = page <= 1 && consumed < source.length;
    const nextPage = nextNodeSeekPostPage(html, id, page);
    const hasMore = hasPageRemainder || Boolean(nextPage);
    return {
      items,
      hasMore,
      nextPage: hasMore ? (hasPageRemainder ? page : nextPage || page + 1) : null,
      nextOffset: hasMore ? consumed : null
    };
  }
  if (!postData) {
    throw new Error('NodeSeek 主题解析失败');
  }
  const comments = arrayField(postData.comments);
  if (page <= 1) {
    const allReplies = normalizeReplies(comments, { skipFirst: true });
    const items = allReplies.slice(offset, offset + limit);
    const consumed = offset + items.length;
    const hasPageRemainder = consumed < allReplies.length;
    const nextPage = nextNodeSeekPostPage(html, id, 1);
    const hasMore = hasPageRemainder || Boolean(nextPage);
    return {
      items,
      hasMore,
      nextPage: hasMore ? (hasPageRemainder ? 1 : nextPage || 2) : null,
      nextOffset: hasMore ? consumed : null
    };
  }
  const floorOffset = hasOffset ? offset : ((page - 1) * limit);
  const items = normalizeReplies(comments, { skipFirst: false, floorOffset });
  const nextPage = nextNodeSeekPostPage(html, id, page);
  const hasMore = Boolean(nextPage);
  return {
    items,
    hasMore,
    nextPage: nextPage || null,
    nextOffset: hasMore ? floorOffset + items.length : null
  };
}

export async function getNodeSeekUserProfile(id: string, options: NodeSeekOptions = {}): Promise<UserProfile> {
  const userData = await fetchNodeSeekJson(`/api/account/getInfo/${encodeURIComponent(id)}?readme=1`, options);
  if (!isRecord(userData) || userData.success === false || !isRecord(userData.detail)) {
    throw new Error('NodeSeek 用户主页读取失败');
  }
  const user = userData.detail;
  const username = String(user.member_name || user.username || user.name || id).trim() || id;
  const userId = String(user.member_id || user.id || id).trim() || id;
  const avatar = absoluteUrl(user.avatar || `/avatar/${encodeURIComponent(userId)}.png`, BASE_URL);
  const bio = String(user.bio || user.readme || '').trim() || undefined;
  const joinedAt = toIsoString(user.created_at || user.createdAt || user.createdDate);
  const discussionData = await fetchNodeSeekJson(`/api/content/list-discussions?uid=${encodeURIComponent(userId)}&page=1`, options);
  const discussions = isRecord(discussionData) && Array.isArray(discussionData.discussions) ? discussionData.discussions : [];
  const topics = discussions.filter(isRecord).map((discussion) => {
    const topicId = String(discussion.post_id || discussion.postId || discussion.id || '').trim();
    const title = String(discussion.title || discussion.titleText || '').trim();
    if (!topicId || !title) {
      return null;
    }
    const createdAt = nodeSeekCreatedAt(discussion);
    const accessRequirement = accessRequirementFromObject(discussion);
    return {
      source: 'nodeseek' as const,
      id: topicId,
      title,
      author: username,
      authorAvatar: avatar,
      authorId: userId,
      authorUrl: spaceUrl(userId),
      url: safeNodeSeekTopicUrl(topicId, `/post-${topicId}-1`),
      createdAt,
      lastReplyAt: createdAt,
      replyCount: parsePositiveInteger(discussion.comments || discussion.commentCount || discussion.nComment),
      viewCount: parseViewCount(discussion.views || discussion.viewCount),
      ...(accessRequirement ? { accessRequirement } : {})
    };
  }) as Array<Topic | null>;
  const visibleTopics = sortNodeSeekUserTopics(topics.filter(Boolean) as Topic[]);
  return {
    source: 'nodeseek',
    id: userId,
    username,
    displayName: username,
    avatar,
    url: spaceUrl(userId),
    bio,
    joinedAt: joinedAt || undefined,
    topicCount: parsePositiveInteger(user.nPost) || visibleTopics.length || undefined,
    postCount: parsePositiveInteger(user.nPost) || visibleTopics.length || undefined,
    replyCount: parsePositiveInteger(user.nComment) || undefined,
    topics: visibleTopics
  };
}

export async function searchNodeSeek(query: string, options: NodeSeekOptions & { limit?: number; page?: number } = {}): Promise<SearchResponse> {
  const trimmedQuery = query.trim();
  const limit = options.limit || 30;
  const page = options.page || 1;
  if (!trimmedQuery) {
    return { items: [], errors: {}, hasMore: false, nextPage: null };
  }

  let items: Topic[] = [];
  let searchFailed = false;
  let nextPage: number | null = null;
  try {
    const html = await fetchNodeSeekText(searchPath(trimmedQuery, page), options);
    items = filterNodeSeekSearchTopics(html, trimmedQuery);
    nextPage = page < MAX_NODESEEK_SEARCH_PAGES && nextSearchPath(html, page + 1) ? page + 1 : null;
  } catch (error) {
    if (isNodeSeekCloudflareError(error)) {
      throw error;
    }
    searchFailed = true;
  }

  if (searchFailed) {
    const fallback = await getNodeSeekFeed({ ...options, limit: 100 });
    const expression = parseSearchExpression(trimmedQuery);
    items = mergeSearchTopics(items, fallback.items.filter((topic) => (
      matchesSearchExpression(searchExpressionText(topic), expression)
    )));
  }

  return {
    items: sortTopicsByTime(items).slice(0, limit),
    errors: {},
    hasMore: Boolean(nextPage),
    nextPage
  };
}
