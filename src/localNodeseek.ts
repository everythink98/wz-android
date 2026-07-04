import MarkdownIt from 'markdown-it';
import type { HTMLElement } from 'node-html-parser';
import { fetchWithTimeout, type Fetcher } from './request';
import { DEFAULT_NODESEEK_ANDROID_USER_AGENT, hasNodeSeekLoginCookie, parseNodeSeekDocumentCookie } from './nodeseekCookies';
import { googleSiteSearchUrl, hasGoogleSiteSearchNextPage, isGoogleSiteSearchResponse } from './googleSearchFallback';
import type { NodeSeekSearchFilter } from './searchFilters';
import type { Category, FeedResponse, RepliesResponse, Reply, SearchResponse, Topic, TopicDetail, TopicPoll, TopicPollOption, UserProfile } from './types';
import {
  absoluteUrl,
  accessRequirementFromObject,
  accessRequirementFromText,
  elementText,
  isRecord,
  parseHtml,
  parsePositiveInteger,
  sanitizeContentHtml,
  textExcerpt,
  toIsoString
} from './localHtml';
import {
  NODESEEK_BASE_URL,
  extractNodeSeekEmbeddedData,
  isNodeSeekChallengeResponse,
  nextNodeSeekListPage,
  nextNodeSeekPostPage,
  isNodeSeekHost,
  nodeSeekAccessRequirementFromListRow,
  nodeSeekSpaceUrl,
  nodeSeekTopicPagePath,
  nodeSeekTopicUrl,
  safeNodeSeekTopicUrl,
  withNodeSeekReplyPagination
} from './localNodeseekHelpers';

const BASE_URL = NODESEEK_BASE_URL;
const NODESEEK_CLOUDFLARE_MESSAGE = 'NodeSeek 需要完成 Cloudflare 验证';
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

interface NodeSeekOptions {
  fetcher?: Fetcher;
  nocache?: boolean;
  nodeSeekCookie?: string;
  nodeSeekUserAgent?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function markdownToHtml(markdown: unknown) {
  return sanitizeContentHtml(md.render(String(markdown || '')), BASE_URL);
}

function hasHtmlTag(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function nodeSeekDisplayHtml(content: unknown, markdown: unknown) {
  const renderedHtml = typeof content === 'string' ? content.trim() : '';
  if (renderedHtml && hasHtmlTag(renderedHtml)) {
    return sanitizeContentHtml(renderedHtml, BASE_URL);
  }
  const markdownText = typeof markdown === 'string' ? markdown.trim() : '';
  if (markdownText && hasHtmlTag(markdownText)) {
    return sanitizeContentHtml(markdownText, BASE_URL);
  }
  return markdownToHtml(markdownText || renderedHtml);
}

function nodeSeekEditableMarkdown(markdown: unknown) {
  const raw = typeof markdown === 'string' ? markdown : '';
  return raw.trim() && !hasHtmlTag(raw) ? raw : '';
}

function nodeSeekSignatureHtml(signature: unknown) {
  const raw = String(signature || '').trim();
  if (!raw) {
    return undefined;
  }
  return hasHtmlTag(raw) ? sanitizeContentHtml(raw, BASE_URL) : markdownToHtml(raw);
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

function extractNodeSeekVoteIds(...values: unknown[]) {
  const ids = new Set<string>();
  values.forEach((value) => {
    const text = String(value || '');
    for (const match of text.matchAll(/nsapp:\/\/vote\?id=(\d+)/gi)) {
      ids.add(match[1]);
    }
  });
  return [...ids];
}

function normalizeNodeSeekVoteInfo(value: unknown, fallbackId: string): TopicPoll | null {
  const source = isRecord(value) && isRecord(value.vote)
    ? value.vote
    : isRecord(value) && isRecord(value.detail)
      ? value.detail
      : isRecord(value)
        ? value
        : null;
  if (!source) {
    return null;
  }
  const pollId = String(source.id || source.voteId || fallbackId).trim();
  const options = arrayField(source.items || source.options)
    .filter(isRecord)
    .map((item): TopicPollOption | null => {
      const id = String(item.vote_item_id || item.id || item.itemId || '').trim();
      const label = String(item.text || item.label || item.name || item.title || '').trim();
      if (!id || !label) {
        return null;
      }
      const count = optionalInteger(item.count ?? item.votes);
      return {
        id,
        label,
        ...(count !== undefined ? { count } : {}),
        selected: optionalBoolean(item.voted ?? item.selected) === true
      };
    })
    .filter((item): item is TopicPollOption => Boolean(item));
  if (!pollId || !options.length) {
    return null;
  }
  return {
    id: pollId,
    title: String(source.title || '').trim() || undefined,
    public: optionalBoolean(source.isPublic ?? source.public),
    closed: optionalBoolean(source.locked ?? source.closed),
    multiple: optionalBoolean(source.multiple),
    voted: optionalBoolean(source.voted) === true || options.some((option) => option.selected),
    options
  };
}

function nodeSeekElementHasAttribute(element: HTMLElement, name: string) {
  return Object.prototype.hasOwnProperty.call(element.attributes, name);
}

function nodeSeekParentElement(element: HTMLElement | null | undefined) {
  return element?.parentNode && 'rawTagName' in element.parentNode
    ? element.parentNode as HTMLElement
    : null;
}

function nearestNodeSeekLabel(element: HTMLElement) {
  let current: HTMLElement | null = element;
  while (current) {
    if (String(current.rawTagName || '').toLowerCase() === 'label') {
      return current;
    }
    current = nodeSeekParentElement(current);
  }
  return null;
}

function nodeSeekPollCountFromElement(element: HTMLElement | null | undefined) {
  if (!element) {
    return undefined;
  }
  const dataCount = optionalInteger(
    element.getAttribute('data-count')
    || element.getAttribute('data-votes')
    || element.getAttribute('aria-label')
  );
  if (dataCount !== undefined) {
    return dataCount;
  }
  const text = elementText(element);
  const match = text.match(/(\d[\d,]*)\s*(?:票|votes?)/i);
  return match ? optionalInteger(match[1]) : undefined;
}

function cleanNodeSeekPollOptionLabel(value: string, countText?: string) {
  let label = value;
  if (countText) {
    label = label.replace(countText, ' ');
  }
  return label
    .replace(/\s*\d[\d,]*\s*(?:票|votes?)\b/gi, ' ')
    .replace(/\s*[（(]\s*\d[\d,]*\s*(?:票|votes?)?\s*[)）]\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nodeSeekPollIdFromForm(form: HTMLElement, fallbackIndex: number) {
  const hiddenId = form.querySelectorAll('input[type="hidden"]').find((input) => (
    /^(?:vote_?id|id)$/i.test(String(input.getAttribute('name') || ''))
    && String(input.getAttribute('value') || '').trim()
  ));
  const linkedId = elementText(form).match(/nsapp:\/\/vote\?id=(\d+)/i)?.[1];
  const rawId = form.getAttribute('data-vote-id')
    || form.getAttribute('data-voteid')
    || form.getAttribute('data-id')
    || hiddenId?.getAttribute('value')
    || linkedId
    || String(form.getAttribute('id') || '').match(/(?:vote|poll)[-_]?(\d+)/i)?.[1]
    || '';
  return String(rawId || `rendered-${fallbackIndex}`).trim();
}

function nodeSeekPollTitleFromForm(form: HTMLElement) {
  const titleElement = form.querySelector('legend')
    || form.querySelector('.vote-title')
    || form.querySelector('.poll-title')
    || form.querySelector('[data-title]')
    || form.querySelector('h1, h2, h3, h4');
  const title = titleElement?.getAttribute('data-title') || elementText(titleElement);
  return title.trim() || undefined;
}

function nodeSeekPollOptionFromInput(form: HTMLElement, input: HTMLElement): TopicPollOption | null {
  const id = String(
    input.getAttribute('value')
    || input.getAttribute('data-vote-item-id')
    || input.getAttribute('data-item-id')
    || input.getAttribute('id')
    || ''
  ).trim();
  if (!id) {
    return null;
  }
  const inputId = String(input.getAttribute('id') || '').trim();
  const explicitLabel = inputId
    ? form.querySelectorAll('label').find((label) => label.getAttribute('for') === inputId)
    : null;
  const labelContainer = nearestNodeSeekLabel(input) || explicitLabel || nodeSeekParentElement(input);
  const countElement = labelContainer?.querySelector('.vote-count, .poll-count, .count, [data-count], [data-votes]');
  const countText = elementText(countElement);
  const label = cleanNodeSeekPollOptionLabel(elementText(labelContainer), countText);
  if (!label) {
    return null;
  }
  const count = nodeSeekPollCountFromElement(countElement) ?? nodeSeekPollCountFromElement(labelContainer);
  return {
    id,
    label,
    ...(count !== undefined ? { count } : {}),
    selected: nodeSeekElementHasAttribute(input, 'checked') || /(?:selected|active|checked)/i.test(String(labelContainer?.getAttribute('class') || ''))
  };
}

function nodeSeekElementHasContent(element: HTMLElement) {
  if (elementText(element).trim()) {
    return true;
  }
  return Boolean(element.querySelector('img, video, audio, table, pre, code, svg, canvas, input, textarea, select'));
}

function removeEmptyRenderedNodeSeekPollShells(root: HTMLElement) {
  root.querySelectorAll('.form-mask').forEach((element) => element.remove());
  ['.embed-vote', '.vote-panel'].forEach((selector) => {
    root.querySelectorAll(selector).forEach((element) => {
      if (!nodeSeekElementHasContent(element)) {
        element.remove();
      }
    });
  });
  root.querySelectorAll('p').forEach((element) => {
    if (!nodeSeekElementHasContent(element)) {
      element.remove();
    }
  });
}

function parseRenderedNodeSeekPollForms(html: string) {
  const root = parseHtml(`<body>${html}</body>`);
  const forms = root.querySelectorAll('form').filter((form) => {
    const marker = [
      form.getAttribute('class'),
      form.getAttribute('id'),
      form.getAttribute('action'),
      form.getAttribute('data-vote-id'),
      form.getAttribute('data-voteid'),
      elementText(form)
    ].join(' ');
    return /vote|poll/i.test(marker)
      || form.querySelectorAll('input[type="radio"], input[type="checkbox"]').some((input) => /^(?:ids?|ids\[\]|vote|vote-item|option)$/i.test(String(input.getAttribute('name') || '')));
  });
  const polls = forms.map((form, index): TopicPoll | null => {
    const inputs = form.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    const options = inputs
      .map((input) => nodeSeekPollOptionFromInput(form, input))
      .filter((option): option is TopicPollOption => Boolean(option));
    if (!options.length) {
      return null;
    }
    const formText = elementText(form);
    const explicitMultiple = optionalBoolean(form.getAttribute('data-multiple') ?? form.getAttribute('multiple'));
    const multiple = explicitMultiple ?? inputs.some((input) => String(input.getAttribute('type') || '').toLowerCase() === 'checkbox');
    const publicState = /不公开|匿名/.test(formText)
      ? false
      : /公开/.test(formText)
        ? true
        : undefined;
    const closed = /已关闭|投票关闭|closed/i.test(formText) || undefined;
    const voted = options.some((option) => option.selected) || /已投票|已选择|voted/i.test(formText) || undefined;
    return {
      id: nodeSeekPollIdFromForm(form, index),
      title: nodeSeekPollTitleFromForm(form),
      multiple,
      ...(publicState !== undefined ? { public: publicState } : {}),
      ...(closed ? { closed } : {}),
      ...(voted ? { voted } : {}),
      options
    };
  }).filter((poll): poll is TopicPoll => Boolean(poll));
  forms.forEach((form) => form.remove());
  removeEmptyRenderedNodeSeekPollShells(root);
  const cleaned = root.querySelector('body')?.innerHTML || '';
  return {
    html: cleaned.trim(),
    polls: polls.length ? polls : undefined
  };
}

function mergeNodeSeekPolls(...groups: Array<TopicPoll[] | undefined>) {
  const seen = new Set<string>();
  const polls: TopicPoll[] = [];
  for (const group of groups) {
    for (const poll of group || []) {
      const key = poll.id || poll.name || JSON.stringify(poll.options.map((option) => option.id));
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      polls.push(poll);
    }
  }
  return polls.length ? polls : undefined;
}

async function readNodeSeekPollsFromVoteLinks(values: unknown[], options: NodeSeekOptions) {
  const ids = extractNodeSeekVoteIds(...values);
  if (!ids.length) {
    return undefined;
  }
  const polls = (await Promise.all(ids.map(async (id) => {
    try {
      return normalizeNodeSeekVoteInfo(await fetchNodeSeekJson(`/api/vote/info/${encodeURIComponent(id)}`, options), id);
    } catch {
      return null;
    }
  }))).filter((poll): poll is TopicPoll => Boolean(poll));
  return polls.length ? polls : undefined;
}

function nodeSeekEmbeddedUserId(user: Record<string, unknown>) {
  return String(user.uid || user.id || user.userId || user.user_id || user.member_id || '').trim();
}

function nodeSeekLevelLabel(user: Record<string, unknown>) {
  const value = user.rank;
  const level = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isInteger(level) && level >= 0 ? `Lv${level}` : undefined;
}

function nodeSeekRoleLabel(user: Record<string, unknown>) {
  const labels = (Array.isArray(user.roles) ? user.roles : [])
    .map((role) => isRecord(role) ? String(role.display_text || role.displayText || role.name || '').trim() : '')
    .filter((label) => label && label !== '楼主');
  return labels.join(' · ') || undefined;
}

function nodeSeekCurrentUserFromRecord(user: Record<string, unknown>): UserProfile | null {
  const id = String(user.member_id || user.uid || user.id || user.userId || user.user_id || '').trim();
  const username = String(user.member_name || user.username || user.name || user.displayName || '').trim();
  if (!id || !username) {
    return null;
  }
  return {
    source: 'nodeseek',
    id,
    username,
    displayName: username,
    avatar: absoluteUrl(user.avatar || `/avatar/${encodeURIComponent(id)}.png`, BASE_URL),
    url: nodeSeekSpaceUrl(id),
    topics: []
  };
}

function findNodeSeekCurrentUser(value: unknown, seen = new Set<unknown>()): UserProfile | null {
  if (!isRecord(value) || seen.has(value)) {
    return null;
  }
  seen.add(value);
  const direct = nodeSeekCurrentUserFromRecord(value);
  if (direct) {
    return direct;
  }
  for (const key of ['user', 'currentUser', 'current_user', 'account', 'detail', 'member', 'profile']) {
    const found = findNodeSeekCurrentUser(value[key], seen);
    if (found) {
      return found;
    }
  }
  return null;
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
  const categoryId = typeof category.key === 'string' ? category.key : undefined;
  const categoryName = typeof category.name === 'string' ? category.name : typeof raw.categoryWord === 'string' ? raw.categoryWord : undefined;
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
  ].filter(isRecord).map((topic) => normalizeTopic(topic)).filter(Boolean) as Topic[];
}

function nodeSeekSearchTopicUrl(id: string, href: string) {
  try {
    const url = new URL(href, BASE_URL);
    return safeNodeSeekTopicUrl(id, url.searchParams.get('q') || href);
  } catch {
    return safeNodeSeekTopicUrl(id, href);
  }
}

function parseHtmlTopics(html: string) {
  const root = parseHtml(html);
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

function parseNodeSeekSearchTopics(html: string) {
  const embedded = extractNodeSeekEmbeddedData(html);
  const renderedItems = parseHtmlTopics(html);
  const root = parseHtml(html);
  const hasSearchSurface = Boolean(root.querySelector('form[action*="/search"], input[name="q"], .post-list, .empty-state, .notice, .alert'));
  const seen = new Set<string>();
  const items = renderedItems.length || hasSearchSurface ? renderedItems : (embedded ? embeddedTopics(embedded) : []);
  return items.filter((topic) => {
    if (!topic.id || seen.has(topic.id)) {
      return false;
    }
    seen.add(topic.id);
    return true;
  });
}

function isIncompleteNodeSeekSearchPage(html: string, items: Topic[]) {
  if (items.length) {
    return false;
  }
  const root = parseHtml(html);
  const hasResultSurface = Boolean(root.querySelector('li.post-list-item, .post-list, .empty-state, .notice, .alert'));
  if (hasResultSurface) {
    return false;
  }
  return Boolean(root.querySelector('form[action*="/search"], input[name="q"]'));
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
    try {
      return [{ source: 'nodeseek' as const, id: decodeURIComponent(id), name }];
    } catch {
      return [];
    }
  }));
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
  if (options.nocache) {
    headers['Cache-Control'] = 'no-cache';
    headers.Pragma = 'no-cache';
  }
  const response = await fetchWithTimeout(`${BASE_URL}${path}`, {
    headers
  }, options);
  const text = await response.text();
  if (isNodeSeekChallengeResponse(response, text, `${BASE_URL}${path}`)) {
    throw nodeSeekCloudflareError();
  }
  if (!response.ok && (response.status === 403 || response.status === 404) && accessRequirementFromText(text)) {
    return text;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return text;
}

function hasLoggedInNodeSeekCookie(options: NodeSeekOptions) {
  return hasNodeSeekLoginCookie(parseNodeSeekDocumentCookie(options.nodeSeekCookie || ''));
}

async function fetchNodeSeekGoogleSearchText(query: string, page: number, options: NodeSeekOptions = {}) {
  const response = await fetchWithTimeout(googleSiteSearchUrl('nodeseek.com', query, page), {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.7',
      'User-Agent': options.nodeSeekUserAgent || DEFAULT_NODESEEK_ANDROID_USER_AGENT
    }
  }, options);
  const text = await response.text();
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

function searchPath(query: string, page = 1, filter?: NodeSeekSearchFilter) {
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
  const renderedItems = parseHtmlTopics(html);
  const items = renderedItems.length ? renderedItems : (embedded ? embeddedTopics(embedded) : []);
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
    const authorUrl = absoluteUrl(poster.profile, BASE_URL) || (authorId ? nodeSeekSpaceUrl(authorId) : undefined);
    const authorLevelLabel = nodeSeekRoleLabel(poster);
    const rawMarkdown = typeof comment.markdown === 'string' ? comment.markdown : '';
    const contentMarkdown = nodeSeekEditableMarkdown(rawMarkdown);
    const signatureHtml = nodeSeekSignatureHtml(comment.signature);
    const floorIndex = optionalInteger(comment.floorIndex ?? comment.floor);
    return {
      author: String(poster.name || ''),
      authorAvatar: absoluteUrl(poster.avatar, BASE_URL),
      authorId: authorId || undefined,
      authorUrl,
      ...(authorLevelLabel ? { authorLevelLabel } : {}),
      contentHtml: nodeSeekDisplayHtml(comment.content, rawMarkdown),
      ...(contentMarkdown ? { contentMarkdown } : {}),
      createdAt: toIsoString(isRecord(comment.time) ? comment.time.createdDate : comment.createdDate),
      floor: floorIndex ?? floorOffset + start + index + 1,
      commentId: optionalInteger(comment.commentId),
      upvoteCount: optionalInteger(comment.upvoteCount),
      likeCount: optionalInteger(comment.likeCount),
      dislikeCount: optionalInteger(comment.dislikeCount),
      upvoted: optionalBoolean(comment.upvoted),
      liked: optionalBoolean(comment.liked),
      disliked: optionalBoolean(comment.disliked),
      ...(poster.isMe === true ? { canEdit: true, canLike: false } : {}),
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
  const authorUrl = absoluteUrl(op.profile || poster.profile, BASE_URL) || (authorId ? nodeSeekSpaceUrl(authorId) : undefined);
  const authorLevelLabel = nodeSeekRoleLabel(poster) || nodeSeekRoleLabel(op);
  return {
    source: 'nodeseek',
    id,
    title: String(data.title || ''),
    author: String(op.name || poster.name || ''),
    authorAvatar: absoluteUrl(op.avatar || poster.avatar, BASE_URL),
    authorId: authorId || undefined,
    authorUrl,
    ...(authorLevelLabel ? { authorLevelLabel } : {}),
    categoryId,
    category: categoryName,
    url,
    createdAt,
    lastReplyAt,
    replyCount: allReplies.length,
    viewCount: parseViewCount(data.views),
    excerpt: textExcerpt(first.content || first.markdown),
    contentHtml: nodeSeekDisplayHtml(first.content, first.markdown),
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

function mergeRenderedNodeSeekReply(rendered: Reply, embedded?: Reply): Reply {
  if (!embedded) {
    return rendered;
  }
  return {
    ...embedded,
    ...rendered,
    author: rendered.author || embedded.author,
    contentHtml: rendered.contentHtml || embedded.contentHtml,
    createdAt: rendered.createdAt || embedded.createdAt,
    commentId: rendered.commentId ?? embedded.commentId,
    upvoteCount: rendered.upvoteCount ?? embedded.upvoteCount,
    likeCount: rendered.likeCount ?? embedded.likeCount,
    dislikeCount: rendered.dislikeCount ?? embedded.dislikeCount,
    upvoted: rendered.upvoted ?? embedded.upvoted,
    liked: rendered.liked ?? embedded.liked,
    disliked: rendered.disliked ?? embedded.disliked,
    canEdit: embedded.canEdit ?? rendered.canEdit,
    canLike: embedded.canLike ?? rendered.canLike,
    canDelete: embedded.canDelete ?? rendered.canDelete,
    deletePath: embedded.deletePath ?? rendered.deletePath,
    contentMarkdown: embedded.contentMarkdown ?? rendered.contentMarkdown
  };
}

function matchingEmbeddedNodeSeekReply(reply: Reply, embeddedReplies: Reply[]) {
  return embeddedReplies.find((item) => (
    reply.commentId && item.commentId
      ? item.commentId === reply.commentId
      : Boolean(reply.floor && item.floor === reply.floor)
  ));
}

function mergeRenderedNodeSeekTopic(rendered: TopicDetail, embedded?: TopicDetail): TopicDetail {
  if (!embedded) {
    return rendered;
  }
  const replies = rendered.replies.length
    ? rendered.replies.map((reply) => mergeRenderedNodeSeekReply(reply, matchingEmbeddedNodeSeekReply(reply, embedded.replies)))
    : embedded.replies;
  return {
    ...embedded,
    ...rendered,
    title: rendered.title || embedded.title,
    author: rendered.author || embedded.author,
    contentHtml: rendered.contentHtml || embedded.contentHtml,
    createdAt: rendered.createdAt || embedded.createdAt,
    commentId: rendered.commentId ?? embedded.commentId,
    upvoteCount: rendered.upvoteCount ?? embedded.upvoteCount,
    likeCount: rendered.likeCount ?? embedded.likeCount,
    dislikeCount: rendered.dislikeCount ?? embedded.dislikeCount,
    upvoted: rendered.upvoted ?? embedded.upvoted,
    liked: rendered.liked ?? embedded.liked,
    disliked: rendered.disliked ?? embedded.disliked,
    collectionCount: rendered.collectionCount ?? embedded.collectionCount,
    collected: rendered.collected ?? embedded.collected,
    locked: rendered.locked ?? embedded.locked,
    replyCount: rendered.replies.length ? rendered.replyCount : embedded.replyCount,
    replies,
    replyHasMore: rendered.replies.length ? rendered.replyHasMore : embedded.replyHasMore,
    replyNextPage: rendered.replies.length ? rendered.replyNextPage : embedded.replyNextPage,
    replyNextOffset: rendered.replies.length ? rendered.replyNextOffset : embedded.replyNextOffset
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

function renderedNodeSeekRoleLabel(element: HTMLElement | null | undefined) {
  const authorInfo = element?.querySelector('.author-info, .post-info, .comment-author, .reply-author') || element;
  const labels = (authorInfo?.querySelectorAll('.role-tag, .nsk-badge') || [])
    .filter((badge) => !String(badge.getAttribute('class') || '').split(/\s+/).some((className) => className === 'is-poster' || className === 'poster-badge'))
    .map((badge) => elementText(badge))
    .filter((label) => label && label !== '楼主');
  return labels.join(' · ') || undefined;
}

function nodeSeekMetaContent(root: ReturnType<typeof parseHtml>, selector: string) {
  return String(root.querySelector(selector)?.getAttribute('content') || '').trim();
}

function nodeSeekRenderedTitle(root: ReturnType<typeof parseHtml>, restrictedNotice?: string) {
  const titleElement = root.querySelector('.post-title a')
    || root.querySelector('a.post-title')
    || root.querySelector('article .post-title')
    || root.querySelector('.post-detail .post-title')
    || root.querySelector('.post-title')
    || root.querySelector('h1');
  const title = elementText(titleElement)
    || nodeSeekMetaContent(root, 'meta[property="og:title"]')
    || nodeSeekMetaContent(root, 'meta[name="twitter:title"]')
    || elementText(root.querySelector('title'));
  if (title && title !== 'NodeSeek') {
    return title;
  }
  return restrictedNotice ? '受限帖子' : title;
}

function nodeSeekRestrictedNotice(root: ReturnType<typeof parseHtml>) {
  const restricted = root.querySelector('.restricted-post')
    || root.querySelector('.post-restricted');
  const restrictedText = elementText(restricted);
  if (accessRequirementFromText(restrictedText)) {
    return restrictedText;
  }
  const readableContent = root.querySelectorAll('.post-content, .comment-content, .reply-content, .content-item .content')
    .some((node) => elementText(node) || node.querySelector('img, video, pre, code'));
  if (readableContent) {
    return '';
  }
  const explicitText = root.querySelectorAll('.empty-state, .notice, .alert')
    .map((node) => elementText(node))
    .find((text) => accessRequirementFromText(text)) || '';
  if (explicitText) {
    return explicitText;
  }
  if (!root.querySelector('#nsk-body')) {
    return '';
  }
  const bodyLeft = root.querySelector('#nsk-body-left') || root.querySelector('#nsk-body');
  const candidates = (bodyLeft?.querySelectorAll('*') || [])
    .filter((node) => !['script', 'style', 'svg'].includes(String(node.rawTagName || '').toLowerCase()))
    .map((node) => elementText(node))
    .filter((text) => text.length >= 4);
  const accessCandidate = candidates.find((text) => accessRequirementFromText(text));
  if (accessCandidate) {
    return accessCandidate;
  }
  return '';
}

function parseRenderedNodeSeekTopicHtml(html: string, id: string, replyLimit = 30): TopicDetail | null {
  const root = parseHtml(html);
  const firstContentItem = root.querySelector('.content-item');
  const restrictedNotice = nodeSeekRestrictedNotice(root);
  const contentElement = firstContentItem?.querySelector('.post-content')
    || firstContentItem?.querySelector('.content')
    || root.querySelector('article .post-content')
    || root.querySelector('.post-detail .post-content')
    || root.querySelector('.post-content');
  const title = nodeSeekRenderedTitle(root, restrictedNotice);
  const renderedContentHtml = String(contentElement?.innerHTML || '').trim();
  const contentHtml = renderedContentHtml || restrictedNotice;
  if (!title || !contentHtml) {
    return null;
  }
  const accessRequirement = accessRequirementFromText(restrictedNotice);
  const authorContainer = firstContentItem || root.querySelector('article') || root.querySelector('.post-detail') || root;
  const categoryLink = firstContentItem?.querySelector('.content-category a[href*="/categories/"], a[href*="/categories/"]')
    || root.querySelector('article a[href*="/categories/"]')
    || root.querySelector('.post-detail a[href*="/categories/"]')
    || root.querySelector('.post-info a[href*="/categories/"]')
    || root.querySelector('a[href*="/categories/"]');
  const categoryHref = categoryLink?.getAttribute('href') || '';
  const createdAt = renderedNodeSeekTime(firstContentItem?.querySelector('time') || root.querySelector('article time') || root.querySelector('.post-detail time') || root.querySelector('time')) || new Date().toISOString();
  const renderedPolls = parseRenderedNodeSeekPollForms(renderedContentHtml);
  const cleanedContentHtml = renderedContentHtml ? renderedPolls.html : contentHtml;
  const replyRows = root.querySelectorAll('.content-item, .comment-item, .comment-list > li, .comments > li, [id^="comment-"]').filter((row) => {
    const replyContent = row.querySelector('.post-content, .comment-content, .reply-content, .content');
    return Boolean(replyContent?.innerHTML && row !== firstContentItem);
  });
  const allReplies = replyRows.map((row, index) => {
    const replyContent = row.querySelector('.post-content, .comment-content, .reply-content, .content');
    const authorHref = row.querySelector('a[href*="/space/"]')?.getAttribute('href') || '';
    const authorId = authorHref.match(/\/space\/(\d+)/)?.[1];
    const authorLevelLabel = renderedNodeSeekRoleLabel(row);
    return {
      author: renderedNodeSeekAuthor(row),
      authorAvatar: renderedNodeSeekAvatar(row),
      authorId,
      authorUrl: authorHref ? absoluteUrl(authorHref, BASE_URL) : undefined,
      ...(authorLevelLabel ? { authorLevelLabel } : {}),
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
  const authorLevelLabel = renderedNodeSeekRoleLabel(authorContainer);
  return {
    source: 'nodeseek',
    id,
    title,
    author: renderedNodeSeekAuthor(authorContainer),
    authorAvatar: renderedNodeSeekAvatar(authorContainer),
    authorId,
    authorUrl: authorHref ? absoluteUrl(authorHref, BASE_URL) : undefined,
    ...(authorLevelLabel ? { authorLevelLabel } : {}),
    categoryId: categoryHref.match(/\/categories\/([^/?#]+)/)?.[1],
    category: elementText(categoryLink) || undefined,
    url: nodeSeekTopicUrl(id),
    createdAt,
    lastReplyAt,
    replyCount: allReplies.length,
    excerpt: textExcerpt(cleanedContentHtml || contentHtml),
    contentHtml: sanitizeContentHtml(cleanedContentHtml, BASE_URL),
    ...(renderedPolls.polls ? { polls: renderedPolls.polls } : {}),
    ...(accessRequirement ? { accessRequirement } : {}),
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
  return fetchNodeSeekText(nodeSeekTopicPagePath(id, page), options);
}

async function fetchTopicPageData(id: string, page: number, options: NodeSeekOptions) {
  const html = await fetchTopicHtml(id, page, options);
  const embedded = extractNodeSeekEmbeddedData(html);
  const postData = embedded && isRecord(embedded.postData) ? embedded.postData : null;
  const rendered = parseRenderedNodeSeekTopicHtml(html, id, Number.MAX_SAFE_INTEGER);
  if (!postData && !rendered) {
    throw new Error('NodeSeek 主题解析失败');
  }
  return { html, postData, rendered };
}

export async function getNodeSeekTopic(id: string, options: NodeSeekOptions & { replyLimit?: number } = {}) {
  const html = await fetchTopicHtml(id, 1, options);
  const embedded = extractNodeSeekEmbeddedData(html);
  const postData = embedded && isRecord(embedded.postData) ? embedded.postData : null;
  const currentUser = embedded ? findNodeSeekCurrentUser(embedded) : null;
  const rendered = parseRenderedNodeSeekTopicHtml(html, id, options.replyLimit || 30);
  if (rendered) {
    const embeddedTopic = postData ? normalizePostData(postData, id, nodeSeekTopicUrl(id), options.replyLimit || 30) : undefined;
    const topic = mergeRenderedNodeSeekTopic(rendered, embeddedTopic);
    const polls = mergeNodeSeekPolls(
      topic.polls,
      await readNodeSeekPollsFromVoteLinks([topic.contentHtml, html], options)
    );
    return withNodeSeekReplyPagination({
      ...topic,
      ...(polls ? { polls } : {}),
      ...(currentUser ? { currentUser } : {})
    }, html, id, 1);
  }
  if (postData) {
    const comments = arrayField(postData.comments);
    const first = isRecord(comments[0]) ? comments[0] : {};
    const topic = normalizePostData(postData, id, nodeSeekTopicUrl(id), options.replyLimit || 30);
    const polls = mergeNodeSeekPolls(await readNodeSeekPollsFromVoteLinks([first.markdown, html], options));
    return withNodeSeekReplyPagination({
      ...topic,
      ...(polls ? { polls } : {}),
      ...(currentUser ? { currentUser } : {})
    }, html, id, 1);
  }
  throw new Error('NodeSeek 主题解析失败');
}

type NodeSeekRepliesOptions = NodeSeekOptions & {
  page?: number;
  limit?: number;
  offset?: number | null;
  fillPages?: boolean;
};

async function fillNodeSeekRepliesLimit(id: string, options: NodeSeekRepliesOptions, result: RepliesResponse, limit: number): Promise<RepliesResponse> {
  if (result.items.length >= limit || !result.hasMore || !result.nextPage) {
    return result;
  }
  const page = options.page || 1;
  const offset = typeof options.offset === 'number' ? options.offset : null;
  if (result.nextPage === page && result.nextOffset === offset) {
    return result;
  }
  const extra = await getNodeSeekReplies(id, {
    ...options,
    page: result.nextPage,
    offset: result.nextOffset,
    limit: limit - result.items.length
  });
  return {
    ...extra,
    items: [...result.items, ...extra.items]
  };
}

export async function getNodeSeekReplies(id: string, options: NodeSeekRepliesOptions): Promise<RepliesResponse> {
  const page = options.page || 1;
  const limit = options.limit || 30;
  const { html, postData, rendered } = await fetchTopicPageData(id, page, options);
  const hasOffset = typeof options.offset === 'number' && options.offset >= 0;
  const offset = hasOffset ? options.offset as number : 0;
  const floorOffset = hasOffset ? offset : ((page - 1) * limit);
  if (rendered && (rendered.replies.length || !postData)) {
    const renderedSource = page <= 1 ? rendered.replies : rendered.replies.map((reply, index) => ({
      ...reply,
      floor: reply.floor ?? floorOffset + index + 1
    }));
    const embeddedReplies = postData
      ? normalizeReplies(arrayField(postData.comments), { skipFirst: page <= 1, floorOffset: page <= 1 ? 0 : floorOffset })
      : [];
    const source = embeddedReplies.length
      ? renderedSource.map((reply) => mergeRenderedNodeSeekReply(reply, matchingEmbeddedNodeSeekReply(reply, embeddedReplies)))
      : renderedSource;
    const items = page <= 1 ? source.slice(offset, offset + limit) : source;
    const consumed = offset + items.length;
    const hasPageRemainder = page <= 1 && consumed < source.length;
    const nextPage = nextNodeSeekPostPage(html, id, page);
    const hasMore = hasPageRemainder || Boolean(nextPage);
    const result = {
      items,
      hasMore,
      nextPage: hasMore ? (hasPageRemainder ? page : nextPage || page + 1) : null,
      nextOffset: hasMore ? consumed : null
    };
    return options.fillPages ? fillNodeSeekRepliesLimit(id, options, result, limit) : result;
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
    const result = {
      items,
      hasMore,
      nextPage: hasMore ? (hasPageRemainder ? 1 : nextPage || 2) : null,
      nextOffset: hasMore ? consumed : null
    };
    return options.fillPages ? fillNodeSeekRepliesLimit(id, options, result, limit) : result;
  }
  const items = normalizeReplies(comments, { skipFirst: false, floorOffset });
  const nextPage = nextNodeSeekPostPage(html, id, page);
  const hasMore = Boolean(nextPage);
  const result = {
    items,
    hasMore,
    nextPage: nextPage || null,
    nextOffset: hasMore ? floorOffset + items.length : null
  };
  return options.fillPages ? fillNodeSeekRepliesLimit(id, options, result, limit) : result;
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
  const levelLabel = nodeSeekLevelLabel(user);
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
      authorUrl: nodeSeekSpaceUrl(userId),
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
    url: nodeSeekSpaceUrl(userId),
    bio,
    joinedAt: joinedAt || undefined,
    topicCount: parsePositiveInteger(user.nPost) || visibleTopics.length || undefined,
    postCount: parsePositiveInteger(user.nPost) || visibleTopics.length || undefined,
    replyCount: parsePositiveInteger(user.nComment) || undefined,
    ...(levelLabel ? { levelLabel } : {}),
    topics: visibleTopics
  };
}

export async function getNodeSeekBasicUserProfile(id: string, options: NodeSeekOptions = {}): Promise<UserProfile> {
  const userData = await fetchNodeSeekJson(`/api/account/getInfo/${encodeURIComponent(id)}?readme=1`, options);
  if (!isRecord(userData) || userData.success === false || !isRecord(userData.detail)) {
    throw new Error('NodeSeek 用户身份读取失败');
  }
  const user = userData.detail;
  const userId = String(user.member_id || user.id || id).trim() || id;
  const username = String(user.member_name || user.username || user.name || userId).trim() || userId;
  return {
    source: 'nodeseek',
    id: userId,
    username,
    displayName: username,
    avatar: absoluteUrl(user.avatar || `/avatar/${encodeURIComponent(userId)}.png`, BASE_URL),
    url: nodeSeekSpaceUrl(userId),
    topics: []
  };
}

function parseNodeSeekCurrentUserHtml(html: string) {
  const embeddedUser = findNodeSeekCurrentUser(extractNodeSeekEmbeddedData(html));
  if (embeddedUser) {
    return embeddedUser;
  }
  const root = parseHtml(html);
  const text = elementText(root);
  const uid = text.match(/UID\s*[:：]\s*(\d+)/i)?.[1] || '';
  const explicitUserLink = root.querySelector('a.Username[href*="/space/"]') || root.querySelector('.Username a[href*="/space/"]');
  const explicitUserId = explicitUserLink?.getAttribute('href')?.match(/\/space\/(\d+)/i)?.[1] || '';
  const spaceLinks = root.querySelectorAll('a[href*="/space/"]').filter((link) => /\/space\/\d+/i.test(link.getAttribute('href') || ''));
  const spaceLink = uid
    ? spaceLinks.find((link) => link.getAttribute('href')?.match(/\/space\/(\d+)/i)?.[1] === uid)
    : explicitUserLink;
  const id = uid || explicitUserId;
  if (!id) {
    return null;
  }
  const img = spaceLink?.querySelector('img');
  const username = elementText(spaceLink) || String(img?.getAttribute('alt') || '').trim() || id;
  return {
    source: 'nodeseek' as const,
    id,
    username,
    displayName: username,
    avatar: absoluteUrl(img?.getAttribute('src'), BASE_URL),
    url: nodeSeekSpaceUrl(id),
    topics: []
  };
}

export async function getNodeSeekCurrentUserProfile(options: NodeSeekOptions = {}): Promise<UserProfile> {
  try {
    const data = await fetchNodeSeekJson('/api/account/getInfo?readme=1', options);
    const user = findNodeSeekCurrentUser(data);
    if (user) {
      return user;
    }
  } catch {
    // Fall back to the rendered home page below.
  }
  let lastError: unknown;
  for (const path of ['/', '/setting']) {
    try {
      const user = parseNodeSeekCurrentUserHtml(await fetchNodeSeekText(path, options));
      if (user) {
        return user;
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError && options.signal?.aborted) {
    throw lastError;
  }
  throw new Error('无法读取当前 NodeSeek 用户身份，请重新检测 NodeSeek 登录。');
}

export async function searchNodeSeek(query: string, options: NodeSeekOptions & { limit?: number; page?: number; filter?: NodeSeekSearchFilter } = {}): Promise<SearchResponse> {
  const trimmedQuery = query.trim();
  const limit = options.limit || 30;
  const page = options.page || 1;
  if (!trimmedQuery) {
    return { items: [], errors: {}, hasMore: false, nextPage: null };
  }

  let items: Topic[] = [];
  let nextPage: number | null = null;
  try {
    const useGoogleSearch = !hasLoggedInNodeSeekCookie(options);
    const html = useGoogleSearch
      ? await fetchNodeSeekGoogleSearchText(trimmedQuery, page, options)
      : await fetchNodeSeekText(searchPath(trimmedQuery, page, options.filter), options);
    items = parseNodeSeekSearchTopics(html);
    if (isIncompleteNodeSeekSearchPage(html, items)) {
      throw new Error('NodeSeek 搜索页结果没有加载完成，请重试');
    }
    nextPage = useGoogleSearch || isGoogleSiteSearchResponse(html, 'nodeseek.com')
      ? hasGoogleSiteSearchNextPage(html, 'nodeseek.com', page + 1) ? page + 1 : null
      : nextSearchPath(html, page + 1) ? page + 1 : null;
  } catch (error) {
    if (isNodeSeekCloudflareError(error)) {
      throw error;
    }
    throw error;
  }

  return {
    items: items.slice(0, limit),
    errors: {},
    hasMore: Boolean(nextPage),
    nextPage
  };
}
