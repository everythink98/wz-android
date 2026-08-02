import type { HTMLElement } from 'node-html-parser';
import type { RepliesResponse, TopicDetail, TopicPoll, TopicPollOption } from '@/domain/forum/models';
import {
  absoluteUrl,
  elementText,
  hasRenderableHtmlContent,
  parseHtml,
  parsePositiveInteger,
  textContentFromHtml,
  textExcerpt
} from '@/domain/forum/html';
import { sanitizeContentHtml } from '@/domain/forum/contentSanitizer';
import { accessRequirementFromText } from '@/domain/forum/accessRequirements';
import { annotateSourceDiagnosticSummary } from '@/sources/diagnostics';
import {
  YAOHUO_BASE_URL as BASE_URL,
  extractYaohuoTopicParts as extractTopicParts,
  extractYaohuoUserIdFromHref as extractUserIdFromHref,
  nextYaohuoPageFromHtml as nextPageFromHtml,
  yaohuoUserUrl as userUrl
} from './protocol';
import { normalizeYaohuoReplyDeletePath } from './actionRequest';
import { categoryNames, parseYaohuoDate, topicTitle, yaohuoAuthorLevelLabel } from './normalization';
import { ensureYaohuoHtmlLoggedIn } from './sessionParser';

function extractMarkedContent(html: string, start: string, end: string) {
  const marked = extractMarkedContentBounds(html, start, end);
  return marked ? marked.content : html;
}

const yaohuoDownloadContentPattern =
  /下载|网盘|提取码|提取密码|解压密码|访问码|夸克|百度云?|蓝奏|123云盘|迅雷|天翼云|阿里云盘|城通|apk\b|pan\.|quark|lanzou|123pan|aliyundrive|cloud\.189|ctfile|uc\.cn/i;

const yaohuoNonPostClassNames = new Set([
  'content',
  'subtitle',
  'line1',
  'line2',
  'listdata',
  'page',
  'pager',
  'nav',
  'footer',
  'header'
]);

const yaohuoPostBoundaryTextPattern = /原站收藏|回复列表|更多回帖|评论内查找|写回复|只看楼主|只看带图|倒序/;

const yaohuoRawPostBoundaryPatterns = [
  /<div\b[^>]*class=["'][^"']*\blouzhuxinxi\b[^"']*["'][^>]*>/i,
  /<div\b[^>]*class=["'][^"']*\brecontent\b[^"']*["'][^>]*>/i,
  /<div\b[^>]*class=["'][^"']*\bline[12]\b[^"']*["'][^>]*>/i,
  /更多回帖\s*\(/i
];

function extractMarkedContentBounds(html: string, start: string, end: string) {
  const startIndex = html.indexOf(start);
  const contentStart = startIndex + start.length;
  const endIndex = html.indexOf(end, contentStart);
  return startIndex >= 0 && endIndex > contentStart
    ? { content: html.slice(contentStart, endIndex), endIndex: endIndex + end.length }
    : null;
}

function firstYaohuoRawPostBoundaryIndex(html: string) {
  return (
    yaohuoRawPostBoundaryPatterns
      .map((pattern) => html.search(pattern))
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)[0] ?? -1
  );
}

function extractRawYaohuoPostContent(html: string) {
  const marked = extractMarkedContentBounds(html, '<!--listS-->', '<!--listE-->');
  if (!marked) {
    return '';
  }
  const rest = html.slice(marked.endIndex);
  const boundaryIndex = firstYaohuoRawPostBoundaryIndex(rest);
  const followingContent = (boundaryIndex >= 0 ? rest.slice(0, boundaryIndex) : rest).replace(
    /^\s*(?:<\/div>\s*)+/,
    ''
  );
  return [marked.content, followingContent].filter((part) => hasRenderableHtmlContent(part)).join('\n');
}

function hasAncestor(node: HTMLElement, ancestor: HTMLElement | null | undefined) {
  let current = node.parentNode;
  while (current) {
    if (current === ancestor) {
      return true;
    }
    current = current.parentNode;
  }
  return false;
}

function hasExcludedYaohuoClass(node: HTMLElement) {
  return String(node.getAttribute('class') || '')
    .toLowerCase()
    .split(/\s+/)
    .some((name) => yaohuoNonPostClassNames.has(name));
}

function isHtmlElementNode(node: unknown): node is HTMLElement {
  return Boolean(
    node && typeof node === 'object' && 'tagName' in node && typeof (node as HTMLElement).getAttribute === 'function'
  );
}

function isYaohuoPostBoundaryNode(node: HTMLElement) {
  if (hasExcludedYaohuoClass(node)) {
    return true;
  }
  const href = node.getAttribute('href') || '';
  if (/book_list\.aspx|book_re\.aspx/i.test(href)) {
    return true;
  }
  const html = node.toString();
  const text = elementText(node);
  return isYaohuoPostBoundaryText(text, html);
}

function isYaohuoPostBoundaryText(text: string, html = '') {
  return yaohuoPostBoundaryTextPattern.test(text) && !yaohuoDownloadContentPattern.test(`${text} ${html}`);
}

function collectFollowingYaohuoPostContent(mainContent: HTMLElement | null | undefined) {
  const parent = mainContent?.parentNode;
  if (!parent) {
    return [];
  }
  const chunks: string[] = [];
  let afterMainContent = false;
  for (const node of parent.childNodes) {
    if (node === mainContent) {
      afterMainContent = true;
      continue;
    }
    if (!afterMainContent) {
      continue;
    }
    const html = node.toString();
    const text = textContentFromHtml(html);
    if (!hasRenderableHtmlContent(html)) {
      continue;
    }
    if (isYaohuoPostBoundaryText(text, html)) {
      break;
    }
    if (isHtmlElementNode(node) && isYaohuoPostBoundaryNode(node)) {
      break;
    }
    chunks.push(html);
  }
  return chunks;
}

function collectYaohuoDownloadContent(root: ReturnType<typeof parseHtml>, mainContent: HTMLElement | null | undefined) {
  const selected: HTMLElement[] = [];
  for (const node of root.querySelectorAll('div, p, table, ul, ol, a')) {
    if (node === mainContent || hasAncestor(node, mainContent) || (mainContent && hasAncestor(mainContent, node))) {
      continue;
    }
    if (hasExcludedYaohuoClass(node)) {
      continue;
    }
    const html = node.toString();
    const text = elementText(node);
    if (!yaohuoDownloadContentPattern.test(`${text} ${html}`)) {
      continue;
    }
    if (selected.some((parent) => hasAncestor(node, parent))) {
      continue;
    }
    selected.push(node);
  }
  return selected.map((node) => node.toString());
}

function appendYaohuoPostContent(
  contentHtml: string,
  root: ReturnType<typeof parseHtml>,
  mainContent: HTMLElement | null | undefined
) {
  const followingContent = collectFollowingYaohuoPostContent(mainContent);
  const extraHtml = followingContent.length ? followingContent : collectYaohuoDownloadContent(root, mainContent);
  return [contentHtml, ...extraHtml].filter((part) => hasRenderableHtmlContent(part)).join('\n');
}

function escapeHtmlText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readableYaohuoActivityText(value: unknown) {
  return textContentFromHtml(value)
    .replace(/(派币|礼金|每人|余|获赏)\s*(\d+)/g, '$1 $2')
    .replace(/(\d+)\s*(已结束|已开始|进行中|未开始)/g, '$1 $2')
    .replace(/(\d+)\s*(派币|礼金|每人|余|获赏)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function yaohuoActivitySummaryHtml(root: ReturnType<typeof parseHtml>) {
  const parts = [
    root.querySelector('.notification-text'),
    root.querySelector('.paibi'),
    root.querySelector('#stamp-badge, .post-badge')
  ]
    .map((node) => readableYaohuoActivityText(node?.toString() || ''))
    .filter(Boolean);
  return parts.length
    ? `<blockquote>${parts.map((part) => `<p>${escapeHtmlText(part)}</p>`).join('')}</blockquote>`
    : '';
}

function parseVoteOptions(html: string) {
  const root = parseHtml(html);
  const options: TopicPollOption[] = [];
  root.querySelectorAll('.toupiao').forEach((element) => {
    element.querySelectorAll('a[href*="vid="]').forEach((link) => {
      const id = link.getAttribute('href')?.match(/[?&]vid=(\d+)/i)?.[1];
      const text = elementText(link);
      if (!id || !text) {
        return;
      }
      const count = parsePositiveInteger(
        text.match(/[（(]\s*(\d+)\s*(?:票)?\s*[）)]\s*$/)?.[1] || text.match(/(\d+)\s*票\s*$/)?.[1]
      );
      const label = text
        .replace(/^\[[^\]]+\]\s*/, '')
        .replace(/[（(]\s*\d+\s*(?:票)?\s*[）)]\s*$/, '')
        .replace(/\d+\s*票\s*$/, '')
        .trim();
      if (label) {
        options.push({ id, label, count, selected: /已投|已选|当前/i.test(text) });
      }
    });
  });
  return options;
}

function parseYaohuoVoteChoiceLimits(text: string) {
  const min = parsePositiveInteger(text.match(/至少\s*(?:选择)?\s*(\d+)\s*项/i)?.[1]) || undefined;
  const max = parsePositiveInteger(text.match(/(?:最多\s*(?:选择)?|可选)\s*(\d+)\s*项/i)?.[1]) || undefined;
  return { min, max };
}

function parseVotePolls(html: string, topicId: string): TopicPoll[] | undefined {
  const options = parseVoteOptions(html);
  if (!options.length) {
    return undefined;
  }
  const text = textContentFromHtml(html);
  const { min, max } = parseYaohuoVoteChoiceLimits(text);
  const multiple = /多选|可选\s*\d+\s*项|至少\s*(?:选择\s*)?\d+\s*项|至少\s*选择|最多\s*(?:选择)?\s*\d+\s*项/i.test(
    text
  );
  return [
    {
      id: `yaohuo-${topicId}`,
      title: '投票',
      voted: options.some((option) => option.selected) || /已投票|已经投票|您已投/i.test(text),
      closed: /投票(?:已)?(?:结束|关闭|截止)|已结束投票/i.test(text),
      multiple,
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      options
    }
  ];
}

function yaohuoTopicAccessRequirementFromContent(html: string) {
  const accessRequirement = accessRequirementFromText(html);
  if (!accessRequirement || accessRequirement.type !== 'login') {
    return accessRequirement;
  }
  const text = textContentFromHtml(html);
  return /请先\s*登录|登录后(?:可|才|才能)?(?:查看|访问|回复|阅读)|需要\s*登录(?:后)?(?:才|才能|可)?(?:查看|访问|回复|阅读)|未登录[^。；\n]{0,20}(?:无法|不能|不可|禁止)?(?:查看|访问|回复|阅读)/i.test(
    text
  )
    ? accessRequirement
    : undefined;
}

export function parseYaohuoFavoriteRecordId(html: string, topicId: string | number) {
  const expectedTopicId = String(topicId).trim();
  if (!/^\d+$/.test(expectedTopicId)) {
    return undefined;
  }
  const row = parseHtml(html)
    .querySelectorAll('.modern-list-item')
    .find((item) => {
      const topicLink = item
        .querySelectorAll('a[href]')
        .find((link) => extractTopicParts(link.getAttribute('href')).id === expectedTopicId);
      return Boolean(topicLink);
    });
  return parsePositiveInteger(row?.querySelector('[data-fav-id]')?.getAttribute('data-fav-id')) || undefined;
}

export function parseYaohuoTopicHtml(html: string, { id, url }: { id: string; url?: string }): TopicDetail {
  ensureYaohuoHtmlLoggedIn(html, url);
  const root = parseHtml(html);
  const bbsContentElement = root.querySelector('div.bbscontent');
  const bbsContent = bbsContentElement?.innerHTML || '';
  const activitySummaryHtml = yaohuoActivitySummaryHtml(root);
  const postContentHtml =
    extractRawYaohuoPostContent(html) ||
    appendYaohuoPostContent(extractMarkedContent(bbsContent, '<!--listS-->', '<!--listE-->'), root, bbsContentElement);
  const contentHtml = [activitySummaryHtml, postContentHtml]
    .filter((part) => hasRenderableHtmlContent(part))
    .join('\n');
  const contentText = elementText(root.querySelector('div.content'));
  const classId = root
    .querySelectorAll('a[href*="classid="]')
    .map((link) => link.getAttribute('href')?.match(/[?&]classid=(\d+)/i)?.[1])
    .find(Boolean);
  const author =
    elementText(root.querySelector('div.subtitle a[href*="userinfo"], div.subtitle a[href*="touserid"]')) ||
    elementText(root.querySelector('div.subtitle a'));
  const authorHref =
    root.querySelector('div.subtitle a[href*="userinfo"], div.subtitle a[href*="touserid"]')?.getAttribute('href') ||
    '';
  const authorId = extractUserIdFromHref(authorHref);
  const authorLevelLabel = yaohuoAuthorLevelLabel(elementText(root.querySelector('div.louzhuxinxi, div.subtitle')));
  const createdAt =
    parseYaohuoDate(
      contentText.match(/\[时间\]\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2})/)?.[1] ||
        contentText.match(/\[时间\]\s*(\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2})/)?.[1] ||
        contentText.match(/\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/)?.[0]
    ) || new Date().toISOString();
  const polls = parseVotePolls(html, String(id || ''));
  const accessRequirement =
    yaohuoTopicAccessRequirementFromContent(contentHtml) || yaohuoTopicAccessRequirementFromContent(html);
  const result: TopicDetail = {
    source: 'yaohuo',
    id: String(id || ''),
    title: topicTitle(root) || '',
    author,
    authorId,
    authorUrl: authorId ? userUrl(authorId) : authorHref ? absoluteUrl(authorHref, BASE_URL) : undefined,
    categoryId: classId,
    category: classId ? categoryNames.get(classId) : undefined,
    url: url || `${BASE_URL}/bbs-${id}.html`,
    createdAt,
    lastReplyAt: createdAt,
    replyCount: parsePositiveInteger(html.match(/更多回帖\((\d+)\)/)?.[1]),
    viewCount: parsePositiveInteger(contentText.match(/\(阅\s*(\d+)\)/)?.[1]) || undefined,
    excerpt: textExcerpt(contentHtml),
    contentHtml: sanitizeContentHtml(contentHtml, BASE_URL),
    replies: [],
    ...(authorLevelLabel ? { authorLevelLabel } : {}),
    ...(accessRequirement ? { accessRequirement } : {}),
    ...(polls ? { polls } : {})
  };
  const validCount = result.title || result.contentHtml || result.author || result.accessRequirement ? 1 : 0;
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'html-topic',
    candidateCount: 1,
    validCount,
    droppedCount: validCount ? 0 : 1
  });
}

function parseFloor(value: string) {
  const text = value.replace(/楼/g, '').trim();
  if (text === '沙发') return 1;
  if (text === '椅子') return 2;
  if (text === '板凳') return 3;
  const floor = Number(text);
  return Number.isInteger(floor) && floor > 0 ? floor : undefined;
}

function explicitReplyFloor(row: HTMLElement, text: string) {
  return (
    parsePositiveInteger(row.getAttribute('data-floor')) ||
    parsePositiveInteger(String(row.getAttribute('id') || '').match(/floor-(\d+)/i)?.[1]) ||
    parsePositiveInteger(
      row
        .querySelector('.floornumber0')
        ?.getAttribute('title')
        ?.match(/原\s*(\d+)\s*楼/i)?.[1]
    ) ||
    parseFloor(text.match(/\[(沙发|椅子|板凳|\d+楼?)\]/)?.[1] || '')
  );
}

function yaohuoReplyContentHtml(row: HTMLElement, rawHtml: string, authorHtml: string) {
  const rewardHtml = row.querySelector('.remoney')?.toString() || '';
  const replyTextHtml = row.querySelector('.retext')?.innerHTML;
  if (rewardHtml || replyTextHtml !== undefined) {
    return `${rewardHtml}${replyTextHtml || ''}`;
  }
  let contentOnly = rawHtml
    .replace(/^\s*\[\s*(?:<a\b[^>]*>)?\s*(沙发|椅子|板凳|\d+楼?)\s*(?:<\/a>)?\s*\]\s*/i, '')
    .replace(/^\s*\[\s*<a\b[^>]*book_re\.aspx[^>]*(?:reply=|touserid=)[^>]*>[\s\S]*?<\/a>\s*\]\s*/i, '')
    .replace(/\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}[\s\S]*$/i, '');
  const authorIndex = authorHtml ? contentOnly.lastIndexOf(authorHtml) : -1;
  if (authorIndex >= 0) {
    contentOnly = contentOnly.slice(0, authorIndex);
  }
  return contentOnly;
}

function yaohuoReplyDeletePath(row: HTMLElement, url?: string) {
  const deleteLink = row.querySelectorAll('a[href]').find((link) => {
    const href = String(link.getAttribute('href') || '');
    return (
      /book_re_del\.aspx/i.test(href) ||
      String(link.getAttribute('class') || '')
        .split(/\s+/)
        .includes('delete-myfloor')
    );
  });
  const href = deleteLink?.getAttribute('href');
  if (!href) {
    return '';
  }
  try {
    return normalizeYaohuoReplyDeletePath(new URL(href.replace(/&amp;/gi, '&'), url || BASE_URL).toString());
  } catch {
    return '';
  }
}

function yaohuoReplyDeleteId(deletePath: string) {
  if (!deletePath) {
    return undefined;
  }
  try {
    return parsePositiveInteger(new URL(deletePath, BASE_URL).searchParams.get('reid'));
  } catch {
    return undefined;
  }
}

export function parseYaohuoRepliesHtml(
  html: string,
  { page = 1, limit = 30, url }: { page?: number; limit?: number; url?: string } = {}
): RepliesResponse {
  ensureYaohuoHtmlLoggedIn(html, url);
  const root = parseHtml(html);
  const rows = root.querySelectorAll('div.list-reply, div.line1, div.line2');
  const floorOffset = Math.max(0, page - 1) * limit;
  let missingFloorCount = 0;
  const items = rows
    .map((row, index) => {
      const rawHtml = row.innerHTML;
      const text = elementText(row);
      const explicitFloor = explicitReplyFloor(row, text);
      if (!explicitFloor) {
        missingFloorCount += 1;
      }
      const floor = explicitFloor || floorOffset + index + 1;
      const deletePath = yaohuoReplyDeletePath(row, url);
      const deleteId = yaohuoReplyDeleteId(deletePath);
      const authorLink = row.querySelectorAll('a[href*="userinfo"]').at(-1);
      const actionLink = row.querySelector(
        'a[href*="book_re.aspx"][href*="reply="], a[href*="book_re.aspx"][href*="touserid="]'
      );
      const author = elementText(authorLink);
      const authorId =
        extractUserIdFromHref(authorLink?.getAttribute('href')) ||
        extractUserIdFromHref(actionLink?.getAttribute('href'));
      const createdAt =
        parseYaohuoDate(
          elementText(row.querySelector('.retime')) ||
            text.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/)?.[0] ||
            text.match(/\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/)?.[0]
        ) || new Date().toISOString();
      const authorHtml = authorLink?.toString() || '';
      const contentOnly = yaohuoReplyContentHtml(row, rawHtml, authorHtml);
      return {
        author,
        ...(authorId ? { authorId } : {}),
        ...(authorId ? { authorUrl: userUrl(authorId) } : {}),
        contentHtml: sanitizeContentHtml(contentOnly, url || `${BASE_URL}/bbs/book_re.aspx`),
        createdAt,
        floor,
        ...(deleteId ? { commentId: deleteId } : {}),
        ...(deletePath ? { canDelete: true, deletePath } : {})
      };
    })
    .slice(0, limit);
  const nextPage = nextPageFromHtml(html, page, items.length, limit);
  const result = {
    items,
    hasMore: Boolean(nextPage),
    nextPage
  };
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'html-replies',
    candidateCount: rows.length,
    validCount: items.length,
    droppedCount: Math.max(0, rows.length - items.length),
    missingFloorCount,
    isExpectedEmpty: rows.length === 0,
    hasRepeatedCursor: Boolean(nextPage && nextPage === page)
  });
}
