import MarkdownIt from 'markdown-it';
import { Buffer } from 'buffer';
import { fetchWithTimeout, type Fetcher } from './request';
import type { Category, FeedResponse, RepliesResponse, SearchResponse, Topic, TopicDetail } from './types';
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

const BASE_URL = 'https://www.nodeseek.com';
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

interface NodeSeekOptions {
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function markdownToHtml(markdown: unknown) {
  return sanitizeContentHtml(md.render(String(markdown || '')), BASE_URL);
}

function topicUrl(id: string) {
  return `${BASE_URL}/post-${id}-1`;
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

function normalizeTopic(raw: Record<string, unknown>): Topic | null {
  const id = String(raw.postId || raw.id || '').trim();
  const title = String(raw.titleText || raw.title || '').trim();
  if (!id || !title) {
    return null;
  }
  const op = isRecord(raw.op) ? raw.op : {};
  const category = isRecord(raw.category) ? raw.category : isRecord(raw.node) ? raw.node : {};
  const createdAt = toIsoString(isRecord(raw.time) ? raw.time.createdDate : raw.createdDate) || new Date().toISOString();
  const lastReplyAt = toIsoString(raw.updatedDate || raw.lastReplyAt) || createdAt;
  const accessRequirement = accessRequirementFromObject(raw) || accessRequirementFromText(raw.content);
  return {
    source: 'nodeseek',
    id,
    title,
    author: String(op.name || raw.author || ''),
    authorAvatar: absoluteUrl(op.avatar, BASE_URL),
    categoryId: typeof category.key === 'string' ? category.key : undefined,
    category: typeof category.name === 'string' ? category.name : typeof raw.categoryWord === 'string' ? raw.categoryWord : undefined,
    url: safeNodeSeekTopicUrl(id, raw.titleLink || raw.url),
    createdAt,
    lastReplyAt,
    replyCount: Number(raw.comments || raw.commentCount || 0),
    viewCount: parseViewCount(raw.views || raw.viewCount),
    excerpt: textExcerpt(raw.content || raw.markdown || ''),
    ...(accessRequirement ? { accessRequirement } : {})
  };
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
  const seen = new Set<string>();
  const items: Topic[] = [];
  for (const link of root.querySelectorAll('a[href*="post-"]')) {
    const href = link.getAttribute('href') || '';
    const id = href.match(/post-(\d+)/)?.[1];
    const title = elementText(link);
    if (!id || !title || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const row = link.parentNode as { text?: string } | null;
    const text = String(row?.text || link.text || '');
    items.push({
      source: 'nodeseek',
      id,
      title,
      author: '',
      url: safeNodeSeekTopicUrl(id, href),
      createdAt: new Date().toISOString(),
      lastReplyAt: new Date().toISOString(),
      replyCount: parsePositiveInteger(text.match(/回复\s*(\d+)/)?.[1]),
      excerpt: textExcerpt(text)
    });
  }
  return items;
}

function normalizeCategories(data: Record<string, unknown>) {
  return arrayField(data.allCategory).filter(isRecord).flatMap((category) => {
    const id = String(category.key || category.id || '').trim();
    const name = String(category.cn_text || category.name || category.text || '').trim();
    return id && name && !category.adminOnly ? [{ source: 'nodeseek' as const, id, name }] : [];
  });
}

async function fetchNodeSeekText(path: string, options: NodeSeekOptions = {}) {
  const response = await fetchWithTimeout(`${BASE_URL}${path}`, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml;q=0.8,*/*;q=0.7',
      Referer: BASE_URL
    }
  }, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return text;
}

function listPath(page: number, category?: string) {
  const prefix = category ? `/categories/${encodeURIComponent(category)}` : '';
  return page > 1 ? `${prefix}/page-${page}` : `${prefix || '/'}`;
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
  return {
    items: sortTopicsByTime(filtered).slice(0, limit),
    errors: {},
    hasMore: filtered.length >= limit,
    nextPage: filtered.length >= limit ? page + 1 : null
  };
}

export async function getNodeSeekCategories(options: NodeSeekOptions = {}) {
  const html = await fetchNodeSeekText('/', options);
  const embedded = extractNodeSeekEmbeddedData(html);
  return {
    items: embedded ? normalizeCategories(embedded) : [] as Category[],
    errors: {}
  };
}

function normalizeReplies(comments: unknown[], { skipFirst, start = 0, floorOffset = 0 }: { skipFirst: boolean; start?: number; floorOffset?: number }) {
  const source = skipFirst ? comments.slice(1) : comments;
  return source.slice(start).filter(isRecord).map((comment, index) => {
    const poster = isRecord(comment.poster) ? comment.poster : {};
    return {
      author: String(poster.name || ''),
      authorAvatar: absoluteUrl(poster.avatar, BASE_URL),
      contentHtml: markdownToHtml(comment.markdown),
      createdAt: toIsoString(isRecord(comment.time) ? comment.time.createdDate : comment.createdDate),
      floor: floorOffset + start + index + 1,
      commentId: typeof comment.commentId === 'number' ? comment.commentId : undefined,
      upvoteCount: typeof comment.upvoteCount === 'number' ? comment.upvoteCount : undefined,
      likeCount: typeof comment.likeCount === 'number' ? comment.likeCount : undefined,
      upvoted: typeof comment.upvoted === 'boolean' ? comment.upvoted : undefined,
      liked: typeof comment.liked === 'boolean' ? comment.liked : undefined
    };
  });
}

function normalizePostData(data: Record<string, unknown>, id: string, url: string, replyLimit = 30): TopicDetail {
  const comments = arrayField(data.comments);
  const first = isRecord(comments[0]) ? comments[0] : {};
  const op = isRecord(data.op) ? data.op : {};
  const poster = isRecord(first.poster) ? first.poster : {};
  const category = isRecord(data.category) ? data.category : isRecord(data.node) ? data.node : {};
  const allReplies = normalizeReplies(comments, { skipFirst: true });
  const replies = allReplies.slice(0, replyLimit);
  const createdAt = toIsoString(isRecord(first.time) ? first.time.createdDate : data.createdDate) || new Date().toISOString();
  const lastReplyAt = toIsoString(isRecord(isRecord(comments.at(-1)) ? comments.at(-1)?.time : {}) ? (comments.at(-1) as Record<string, unknown>).time : data.updatedDate) || createdAt;
  const accessRequirement = accessRequirementFromObject(data) || accessRequirementFromText(first.markdown);
  return {
    source: 'nodeseek',
    id,
    title: String(data.title || ''),
    author: String(op.name || poster.name || ''),
    authorAvatar: absoluteUrl(op.avatar || poster.avatar, BASE_URL),
    categoryId: typeof category.key === 'string' ? category.key : undefined,
    category: typeof category.name === 'string' ? category.name : undefined,
    url,
    createdAt,
    lastReplyAt,
    replyCount: allReplies.length,
    viewCount: parseViewCount(data.views),
    excerpt: textExcerpt(first.markdown),
    contentHtml: markdownToHtml(first.markdown),
    commentId: typeof first.commentId === 'number' ? first.commentId : undefined,
    upvoteCount: typeof first.upvoteCount === 'number' ? first.upvoteCount : undefined,
    likeCount: typeof first.likeCount === 'number' ? first.likeCount : undefined,
    upvoted: typeof first.upvoted === 'boolean' ? first.upvoted : undefined,
    liked: typeof first.liked === 'boolean' ? first.liked : undefined,
    ...(accessRequirement ? { accessRequirement } : {}),
    replies,
    replyHasMore: allReplies.length > replyLimit,
    replyNextPage: allReplies.length > replyLimit ? 2 : null,
    replyNextOffset: allReplies.length > replyLimit ? replies.length : null
  };
}

async function fetchTopicData(id: string, page: number, options: NodeSeekOptions) {
  const html = await fetchNodeSeekText(`/post-${encodeURIComponent(id)}-${page}`, options);
  const embedded = extractNodeSeekEmbeddedData(html);
  const postData = embedded && isRecord(embedded.postData) ? embedded.postData : null;
  if (!postData) {
    throw new Error('NodeSeek 主题解析失败');
  }
  return postData;
}

export async function getNodeSeekTopic(id: string, options: NodeSeekOptions & { replyLimit?: number } = {}) {
  const postData = await fetchTopicData(id, 1, options);
  return normalizePostData(postData, id, topicUrl(id), options.replyLimit || 30);
}

export async function getNodeSeekReplies(id: string, options: NodeSeekOptions & {
  page?: number;
  limit?: number;
  offset?: number | null;
}): Promise<RepliesResponse> {
  const page = options.page || 1;
  const limit = options.limit || 30;
  const postData = await fetchTopicData(id, page, options);
  const comments = arrayField(postData.comments);
  const start = typeof options.offset === 'number' ? options.offset : 0;
  const items = normalizeReplies(comments, { skipFirst: true, start }).slice(0, limit);
  const totalReplies = Math.max(comments.length - (page === 1 ? 1 : 0), 0);
  const hasMore = start + items.length < totalReplies;
  return {
    items,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
    nextOffset: hasMore ? start + items.length : null
  };
}

export async function searchNodeSeek(query: string, options: NodeSeekOptions & { limit?: number } = {}): Promise<SearchResponse> {
  const result = await getNodeSeekFeed({ ...options, limit: 100 });
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return {
    items: result.items.filter((topic) => {
      const text = `${topic.title} ${topic.author} ${topic.category || ''} ${topic.excerpt || ''}`.toLowerCase();
      return terms.every((term) => text.includes(term));
    }).slice(0, options.limit || 30),
    errors: {}
  };
}
