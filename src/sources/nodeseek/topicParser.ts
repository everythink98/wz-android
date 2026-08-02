import type { HTMLElement } from 'node-html-parser';
import type { Reply, TopicDetail, TopicPoll, TopicPollOption } from '@/domain/forum/models';
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
} from '@/domain/forum/html';
import {
  NODESEEK_BASE_URL,
  arrayField,
  nodeSeekEmbeddedReplyCount,
  nodeSeekEmbeddedUserId,
  nodeSeekRoleLabel,
  nodeSeekSpaceUrl,
  nodeSeekTopicUrl,
  optionalBoolean,
  optionalInteger,
  parseViewCount
} from './protocol';
import { nodeSeekMarkdownToHtml } from './markdown';
import { nodeSeekPollPlaceholderHtml } from './polls';

const BASE_URL = NODESEEK_BASE_URL;

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
  return nodeSeekMarkdownToHtml(markdownText || renderedHtml);
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
  return hasHtmlTag(raw) ? sanitizeContentHtml(raw, BASE_URL) : nodeSeekMarkdownToHtml(raw);
}

export function extractNodeSeekVoteIds(...values: unknown[]) {
  const ids = new Set<string>();
  values.forEach((value) => {
    const text = String(value || '');
    for (const match of text.matchAll(/nsapp:\/\/vote\?id=(\d+)/gi)) {
      ids.add(match[1]);
    }
  });
  return [...ids];
}

function nodeSeekElementHasAttribute(element: HTMLElement, name: string) {
  return Object.prototype.hasOwnProperty.call(element.attributes, name);
}

function nodeSeekParentElement(element: HTMLElement | null | undefined) {
  return element?.parentNode && 'rawTagName' in element.parentNode ? (element.parentNode as HTMLElement) : null;
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
    element.getAttribute('data-count') || element.getAttribute('data-votes') || element.getAttribute('aria-label')
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
  const hiddenId = form
    .querySelectorAll('input[type="hidden"]')
    .find(
      (input) =>
        /^(?:vote_?id|id)$/i.test(String(input.getAttribute('name') || '')) &&
        String(input.getAttribute('value') || '').trim()
    );
  const linkedId = elementText(form).match(/nsapp:\/\/vote\?id=(\d+)/i)?.[1];
  const rawId =
    form.getAttribute('data-vote-id') ||
    form.getAttribute('data-voteid') ||
    form.getAttribute('data-id') ||
    hiddenId?.getAttribute('value') ||
    linkedId ||
    String(form.getAttribute('id') || '').match(/(?:vote|poll)[-_]?(\d+)/i)?.[1] ||
    '';
  return String(rawId || `rendered-${fallbackIndex}`).trim();
}

function nodeSeekPollTitleFromForm(form: HTMLElement) {
  const titleElement =
    form.querySelector('legend') ||
    form.querySelector('.vote-title') ||
    form.querySelector('.poll-title') ||
    form.querySelector('[data-title]') ||
    form.querySelector('h1, h2, h3, h4');
  const title = titleElement?.getAttribute('data-title') || elementText(titleElement);
  return title.trim() || undefined;
}

function nodeSeekPollOptionFromInput(form: HTMLElement, input: HTMLElement): TopicPollOption | null {
  const id = String(
    input.getAttribute('value') ||
      input.getAttribute('data-vote-item-id') ||
      input.getAttribute('data-item-id') ||
      input.getAttribute('id') ||
      ''
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
    selected:
      nodeSeekElementHasAttribute(input, 'checked') ||
      /(?:selected|active|checked)/i.test(String(labelContainer?.getAttribute('class') || ''))
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
  const wrappedHtml = `<body>${html}</body>`;
  const root = parseHtml(wrappedHtml);
  const forms = root.querySelectorAll('form').filter((form) => {
    const marker = [
      form.getAttribute('class'),
      form.getAttribute('id'),
      form.getAttribute('action'),
      form.getAttribute('data-vote-id'),
      form.getAttribute('data-voteid'),
      elementText(form)
    ].join(' ');
    return (
      /vote|poll/i.test(marker) ||
      form
        .querySelectorAll('input[type="radio"], input[type="checkbox"]')
        .some((input) => /^(?:ids?|ids\[\]|vote|vote-item|option)$/i.test(String(input.getAttribute('name') || '')))
    );
  });
  const parsedPolls = forms.map((form, index): TopicPoll | null => {
    const inputs = form.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    const options = inputs
      .map((input) => nodeSeekPollOptionFromInput(form, input))
      .filter((option): option is TopicPollOption => Boolean(option));
    if (!options.length) {
      return null;
    }
    const formText = elementText(form);
    const explicitMultiple = optionalBoolean(form.getAttribute('data-multiple') ?? form.getAttribute('multiple'));
    const multiple =
      explicitMultiple ?? inputs.some((input) => String(input.getAttribute('type') || '').toLowerCase() === 'checkbox');
    const publicState = /不公开|匿名/.test(formText) ? false : /公开/.test(formText) ? true : undefined;
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
  });
  const polls = parsedPolls.filter((poll): poll is TopicPoll => Boolean(poll));
  const replacements = new Map<string, { end: number; html: string; start: number }>();
  forms.forEach((form, index) => {
    const poll = parsedPolls[index];
    const target = poll?.id ? form.closest('.vote-panel') || form : form;
    const [start, end] = target.range;
    replacements.set(`${start}:${end}`, {
      end,
      html: poll?.id ? nodeSeekPollPlaceholderHtml(poll.id) : '',
      start
    });
  });
  const replacedHtml = [...replacements.values()]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (source, replacement) =>
        `${source.slice(0, replacement.start)}${replacement.html}${source.slice(replacement.end)}`,
      wrappedHtml
    );
  const cleanedRoot = parseHtml(replacedHtml);
  removeEmptyRenderedNodeSeekPollShells(cleanedRoot);
  const cleaned = cleanedRoot.querySelector('body')?.innerHTML || '';
  return {
    html: cleaned.trim(),
    polls: polls.length ? polls : undefined
  };
}

export function mergeNodeSeekPolls(...groups: (TopicPoll[] | undefined)[]) {
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

export function normalizeReplies(
  comments: unknown[],
  { skipFirst, start = 0, floorOffset = 0 }: { skipFirst: boolean; start?: number; floorOffset?: number }
) {
  const source = skipFirst ? comments.slice(1) : comments;
  return source
    .slice(start)
    .filter(isRecord)
    .map((comment, index) => {
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

export function normalizePostData(
  data: Record<string, unknown>,
  id: string,
  url: string,
  replyLimit = 30
): TopicDetail {
  const comments = arrayField(data.comments);
  const first = isRecord(comments[0]) ? comments[0] : {};
  const op = isRecord(data.op) ? data.op : {};
  const poster = isRecord(first.poster) ? first.poster : {};
  const category = isRecord(data.category) ? data.category : isRecord(data.node) ? data.node : {};
  const categoryLink = String(data.categoryLink || '');
  const categoryId =
    typeof category.key === 'string'
      ? category.key
      : typeof data.category === 'string'
        ? data.category
        : categoryLink.match(/\/categories\/([^/?#]+)/)?.[1];
  const categoryName =
    typeof category.name === 'string'
      ? category.name
      : typeof data.categoryWord === 'string'
        ? data.categoryWord
        : undefined;
  const allReplies = normalizeReplies(comments, { skipFirst: true });
  const replies = allReplies.slice(0, replyLimit);
  const replyCount = nodeSeekEmbeddedReplyCount(data, allReplies.length);
  const createdAt =
    toIsoString(isRecord(first.time) ? first.time.createdDate : data.createdDate) || new Date().toISOString();
  const lastComment = comments.at(-1);
  let lastCommentDate: unknown;
  if (isRecord(lastComment)) {
    lastCommentDate = isRecord(lastComment.time) ? lastComment.time.createdDate : lastComment.createdDate;
  }
  const lastReplyAt = toIsoString(lastCommentDate || data.updatedDate) || createdAt;
  const accessRequirement = accessRequirementFromObject(data);
  const authorId = nodeSeekEmbeddedUserId(op) || nodeSeekEmbeddedUserId(poster);
  const authorUrl =
    absoluteUrl(op.profile || poster.profile, BASE_URL) || (authorId ? nodeSeekSpaceUrl(authorId) : undefined);
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
    replyCount,
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

export function mergeRenderedNodeSeekReply(rendered: Reply, embedded?: Reply): Reply {
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

export function matchingEmbeddedNodeSeekReply(reply: Reply, embeddedReplies: Reply[]) {
  return embeddedReplies.find((item) =>
    reply.commentId && item.commentId
      ? item.commentId === reply.commentId
      : Boolean(reply.floor && item.floor === reply.floor)
  );
}

export function mergeRenderedNodeSeekTopic(rendered: TopicDetail, embedded?: TopicDetail): TopicDetail {
  const renderedReplies = rendered.replies.map((reply, index) => ({
    ...reply,
    floor: reply.floor ?? index + 1
  }));
  if (!embedded) {
    return { ...rendered, replies: renderedReplies };
  }
  const replies = renderedReplies.length
    ? renderedReplies.map((reply) =>
        mergeRenderedNodeSeekReply(reply, matchingEmbeddedNodeSeekReply(reply, embedded.replies))
      )
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
  return (
    elementText(element.querySelector('.author-name')) ||
    elementText(element.querySelector('.comment-author')) ||
    elementText(element.querySelector('.reply-author')) ||
    element
      .querySelectorAll('a[href*="/space/"]')
      .map((link) => elementText(link))
      .find(Boolean) ||
    ''
  );
}

function renderedNodeSeekAvatar(element: HTMLElement | null | undefined) {
  if (!element) {
    return undefined;
  }
  return absoluteUrl(
    element
      .querySelector(
        '.author-info a[href*="/space/"] img, .post-info a[href*="/space/"] img, .comment-author img, .reply-author img, a[href*="/space/"] img, img.avatar'
      )
      ?.getAttribute('src'),
    BASE_URL
  );
}

function renderedNodeSeekFloor(element: ReturnType<ReturnType<typeof parseHtml>['querySelectorAll']>[number]) {
  const linkFloor = parsePositiveInteger(elementText(element.querySelector('.floor-link')));
  if (linkFloor) {
    return linkFloor;
  }
  const id = String(element.getAttribute('id') || '');
  return /^\d+$/.test(id) ? Number(id) : undefined;
}

function renderedNodeSeekReactionItem(element: HTMLElement | null | undefined, keywords: string[]) {
  if (!element) {
    return null;
  }
  return (
    element.querySelectorAll('.comment-menu .menu-item').find((item) => {
      const haystack = [
        item.getAttribute('title'),
        item.getAttribute('aria-label'),
        item.getAttribute('class'),
        item.innerHTML
      ]
        .join(' ')
        .toLowerCase();
      return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
    }) || null
  );
}

function renderedNodeSeekReactionCount(element: HTMLElement | null | undefined, keywords: string[]) {
  const item = renderedNodeSeekReactionItem(element, keywords);
  if (!item) {
    return undefined;
  }
  return optionalInteger(
    elementText(item.querySelector('span')) ||
      item.getAttribute('data-count') ||
      item.getAttribute('title') ||
      elementText(item)
  );
}

function renderedNodeSeekReactionClicked(element: HTMLElement | null | undefined, keywords: string[]) {
  const item = renderedNodeSeekReactionItem(element, keywords);
  return item
    ? String(item.getAttribute('class') || '')
        .split(/\s+/)
        .includes('clicked') || undefined
    : undefined;
}

function renderedNodeSeekSignature(element: HTMLElement | null | undefined) {
  const signature = element?.querySelector('.signature, .post-signature, .content-signature');
  return signature?.innerHTML ? sanitizeContentHtml(signature.innerHTML, BASE_URL) : undefined;
}

function renderedNodeSeekIsOp(element: HTMLElement | null | undefined) {
  return (
    Boolean(
      element?.querySelector('.is-poster, .poster-badge') ||
      elementText(element?.querySelector('.role-tag')).trim() === '楼主'
    ) || undefined
  );
}

function renderedNodeSeekRoleLabel(element: HTMLElement | null | undefined) {
  const authorInfo = element?.querySelector('.author-info, .post-info, .comment-author, .reply-author') || element;
  const labels = (authorInfo?.querySelectorAll('.role-tag, .nsk-badge') || [])
    .filter(
      (badge) =>
        !String(badge.getAttribute('class') || '')
          .split(/\s+/)
          .some((className) => className === 'is-poster' || className === 'poster-badge')
    )
    .map((badge) => elementText(badge))
    .filter((label) => label && label !== '楼主');
  return labels.join(' · ') || undefined;
}

function nodeSeekMetaContent(root: ReturnType<typeof parseHtml>, selector: string) {
  return String(root.querySelector(selector)?.getAttribute('content') || '').trim();
}

function nodeSeekRenderedTitle(root: ReturnType<typeof parseHtml>, restrictedNotice?: string) {
  const titleElement =
    root.querySelector('.post-title a') ||
    root.querySelector('a.post-title') ||
    root.querySelector('article .post-title') ||
    root.querySelector('.post-detail .post-title') ||
    root.querySelector('.post-title') ||
    root.querySelector('h1');
  const title =
    elementText(titleElement) ||
    nodeSeekMetaContent(root, 'meta[property="og:title"]') ||
    nodeSeekMetaContent(root, 'meta[name="twitter:title"]') ||
    elementText(root.querySelector('title'));
  if (title && title !== 'NodeSeek') {
    return title;
  }
  return restrictedNotice ? '受限帖子' : title;
}

function nodeSeekRestrictedNotice(root: ReturnType<typeof parseHtml>) {
  const restricted = root.querySelector('.restricted-post') || root.querySelector('.post-restricted');
  const restrictedText = elementText(restricted);
  if (accessRequirementFromText(restrictedText)) {
    return restrictedText;
  }
  const readableContent = root
    .querySelectorAll('.post-content, .comment-content, .reply-content, .content-item .content')
    .some((node) => elementText(node) || node.querySelector('img, video, pre, code'));
  if (readableContent) {
    return '';
  }
  const explicitText =
    root
      .querySelectorAll('.empty-state, .notice, .alert')
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

export function parseRenderedNodeSeekTopicHtml(html: string, id: string, replyLimit = 30): TopicDetail | null {
  const root = parseHtml(html);
  const firstContentItem = root.querySelector('.content-item');
  const restrictedNotice = nodeSeekRestrictedNotice(root);
  const contentElement =
    firstContentItem?.querySelector('.post-content') ||
    firstContentItem?.querySelector('.content') ||
    root.querySelector('article .post-content') ||
    root.querySelector('.post-detail .post-content') ||
    root.querySelector('.post-content');
  const title = nodeSeekRenderedTitle(root, restrictedNotice);
  const renderedContentOuterHtml = contentElement ? html.slice(contentElement.range[0], contentElement.range[1]) : '';
  const renderedContentOpeningEnd = renderedContentOuterHtml.indexOf('>');
  const renderedContentClosingStart = renderedContentOuterHtml
    .toLowerCase()
    .lastIndexOf(`</${String(contentElement?.rawTagName || '').toLowerCase()}`);
  const rawRenderedContentHtml =
    renderedContentOpeningEnd >= 0 && renderedContentClosingStart > renderedContentOpeningEnd
      ? renderedContentOuterHtml.slice(renderedContentOpeningEnd + 1, renderedContentClosingStart)
      : '';
  const renderedContentHtml = String(
    contentElement?.querySelector('.vote-panel') && rawRenderedContentHtml
      ? rawRenderedContentHtml
      : contentElement?.innerHTML || ''
  ).trim();
  const contentHtml = renderedContentHtml || restrictedNotice;
  if (!title || !contentHtml) {
    return null;
  }
  const accessRequirement = accessRequirementFromText(restrictedNotice);
  const authorContainer =
    firstContentItem || root.querySelector('article') || root.querySelector('.post-detail') || root;
  const categoryLink =
    firstContentItem?.querySelector('.content-category a[href*="/categories/"], a[href*="/categories/"]') ||
    root.querySelector('article a[href*="/categories/"]') ||
    root.querySelector('.post-detail a[href*="/categories/"]') ||
    root.querySelector('.post-info a[href*="/categories/"]') ||
    root.querySelector('a[href*="/categories/"]');
  const categoryHref = categoryLink?.getAttribute('href') || '';
  const createdAt =
    renderedNodeSeekTime(
      firstContentItem?.querySelector('time') ||
        root.querySelector('article time') ||
        root.querySelector('.post-detail time') ||
        root.querySelector('time')
    ) || new Date().toISOString();
  const renderedPolls = parseRenderedNodeSeekPollForms(renderedContentHtml);
  const cleanedContentHtml = renderedContentHtml ? renderedPolls.html : contentHtml;
  const replyRows = root
    .querySelectorAll('.content-item, .comment-item, .comment-list > li, .comments > li, [id^="comment-"]')
    .filter((row) => {
      const replyContent = row.querySelector('.post-content, .comment-content, .reply-content, .content');
      return Boolean(replyContent?.innerHTML && row !== firstContentItem);
    });
  const allReplies = replyRows.map((row) => {
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
      floor: renderedNodeSeekFloor(row),
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
    collectionCount: renderedNodeSeekReactionCount(firstContentItem, [
      '收藏',
      'star',
      'favorite',
      'collect',
      'bookmark'
    ]),
    replies,
    replyHasMore: allReplies.length > replyLimit,
    replyNextPage: allReplies.length > replyLimit ? 1 : null,
    replyNextOffset: allReplies.length > replyLimit ? replies.length : null
  };
}
