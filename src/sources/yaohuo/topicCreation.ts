import { decodeHtml, elementText, parseHtml, textContentFromHtml } from '@/domain/forum/html';
import { parseForumTopicLink } from '@/domain/forum/links';
import type {
  CreateTopicInput,
  CreateTopicResult,
  TopicCreationContext,
  YaohuoTopicKind
} from '@/domain/forum/topicComposer';
import { validateTopicDraft } from '@/domain/forum/topicComposer';
import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import { withBrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import { appendFileToFormData } from '@/sources/imageUpload';
import { YAOHUO_ACTION_HEADERS } from './actionClient';
import { YAOHUO_BASE_URL, requireYaohuoRequestUrl } from './protocol';
import { yaohuoLoginRequirementReason } from './sessionParser';

type Options = { fetcher: Fetcher; userAgent: string; signal?: AbortSignal };
const PATHS: Record<YaohuoTopicKind, string> = {
  normal: '/bbs/book_view_add.aspx',
  gift: '/bbs/book_view_sendmoney.aspx',
  poll: '/bbs/book_view_addvote.aspx',
  resources: '/bbs/book_view_addurl.aspx',
  files: '/bbs/book_view_addfile.aspx'
};
const UNKNOWN = '妖火未返回明确发布结果，请到原站核对后再操作';

async function readPage(path: string, { fetcher, userAgent, signal }: Options) {
  const url = requireYaohuoRequestUrl(path);
  const response = await fetchWithTimeout(
    url,
    withBrowserFetchIntent(
      { method: 'GET', headers: { ...YAOHUO_ACTION_HEADERS, 'user-agent': userAgent, 'cache-control': 'no-cache' } },
      { owner: 'write', priority: 'write' }
    ),
    { fetcher, signal }
  );
  const html = await response.text();
  if (yaohuoLoginRequirementReason(html, response.url))
    throw Object.assign(new Error('请重新检测妖火登录后发帖'), { source: 'yaohuo', loginRequired: true });
  if (!response.ok) throw new Error(`妖火发帖表单读取失败：HTTP ${response.status}`);
  if (response.url) requireYaohuoRequestUrl(response.url);
  return { root: parseHtml(html), url };
}

function numberAttribute(root: ReturnType<typeof parseHtml>, selector: string, attribute: string) {
  const value = Number(root.querySelector(selector)?.getAttribute(attribute));
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export async function loadYaohuoTopicCreationContext(options: Options): Promise<TopicCreationContext> {
  const entry = await readPage('/wapindex.aspx?classid=206', options);
  const seen = new Set<string>();
  const categories = entry.root.querySelectorAll('a[href]').flatMap((link) => {
    try {
      const url = new URL(requireYaohuoRequestUrl(decodeHtml(link.getAttribute('href') || ''), entry.url));
      const id = url.searchParams.get('classid') || '';
      const name = elementText(link);
      if (url.pathname.toLowerCase() !== PATHS.normal || !/^\d+$/.test(id) || !name || seen.has(id)) return [];
      seen.add(id);
      return [{ id, name }];
    } catch {
      return [];
    }
  });
  if (!categories.length) throw new Error('妖火未返回可发帖版块，请在原站检查发帖权限');
  const first = await readPage(`${PATHS.normal}?classid=${categories[0]!.id}`, options);
  if (!first.root.querySelector('input[name="book_title"]')) throw new Error('妖火未返回发帖表单');
  const kinds: YaohuoTopicKind[] = ['normal'];
  for (const kind of ['gift', 'poll', 'resources'] as const) {
    if (
      first.root.querySelectorAll('a[href]').some((link) => {
        try {
          return (
            new URL(
              requireYaohuoRequestUrl(decodeHtml(link.getAttribute('href') || ''), first.url)
            ).pathname.toLowerCase() === PATHS[kind]
          );
        } catch {
          return false;
        }
      })
    )
      kinds.push(kind);
  }
  let allowedFileExtensions: string[] = [];
  if (kinds.includes('resources')) {
    const resources = await readPage(`${PATHS.resources}?classid=${categories[0]!.id}&num=1`, options);
    const link = resources.root
      .querySelectorAll('a[href]')
      .find((item) => /book_view_addfile\.aspx/i.test(item.getAttribute('href') || ''));
    if (link) {
      const files = await readPage(
        requireYaohuoRequestUrl(decodeHtml(link.getAttribute('href') || ''), resources.url),
        options
      );
      const accept = files.root.querySelector('input[type="file"]')?.getAttribute('accept');
      if (accept) {
        allowedFileExtensions = accept
          .split(',')
          .map((value) => value.trim().replace(/^\./, '').toLowerCase())
          .filter(Boolean);
        kinds.push('files');
      }
    }
  }
  return {
    source: 'yaohuo',
    categories,
    kinds,
    allowedFileExtensions,
    titleMin: numberAttribute(first.root, '[name="book_title"]', 'minlength') ?? 5,
    titleMax: numberAttribute(first.root, '[name="book_title"]', 'maxlength') ?? 50,
    bodyMin: numberAttribute(first.root, '[name="book_content"]', 'minlength') ?? 15,
    bodyMax: numberAttribute(first.root, '[name="book_content"]', 'maxlength')
  };
}

function postingResult(html: string, response: Response, input: CreateTopicInput): CreateTopicResult {
  if (yaohuoLoginRequirementReason(html, response.url))
    return { status: 'rejected', message: '妖火要求重新登录或完成访问验证' };
  const root = parseHtml(html);
  const tip = root.querySelector('.tip');
  const fullText = textContentFromHtml(html);
  const message = tip ? elementText(tip) : fullText.length <= 120 ? fullText : '';
  const explicitlyRejected = Boolean(
    message &&
    message.length <= 200 &&
    /失败|权限不足|请勿重复|重复提交|错误|禁止|无权|不允许|不能为空|不足|最少|最多/.test(message)
  );
  if (!response.ok)
    return {
      status:
        response.status >= 400 &&
        response.status < 500 &&
        (![408, 409].includes(response.status) || (tip && explicitlyRejected))
          ? 'rejected'
          : 'unknown',
      message: message && message.length <= 200 ? message : `妖火返回 HTTP ${response.status}，请到原站核对发布结果`
    };
  if (explicitlyRejected) return { status: 'rejected', message };
  if (message && /^(?:发表|发帖|发布)(?:新帖|帖子|主题)?成功[！!。\s]*(?:.*等待审核.*|.*待审核.*)$/.test(message))
    return { status: 'enqueued', message };
  if (
    message &&
    /^(?:发表|发帖|发布)(?:新帖|帖子|主题)?成功[！!。\s]*(?:跳转中[.。…]*\s*)?(?:返回|查看帖子|查看主题)?$/.test(
      message
    )
  ) {
    const links =
      tip
        ?.querySelectorAll('a[href]')
        .map((link) => parseForumTopicLink(decodeHtml(link.getAttribute('href') || ''), YAOHUO_BASE_URL))
        .filter((topic) => topic?.source === 'yaohuo') || [];
    const topic =
      links.length === 1 && links[0]
        ? { ...links[0], title: input.draft.title.trim(), categoryId: input.draft.categoryId }
        : undefined;
    return { status: 'posted', message, ...(topic ? { topic } : {}) };
  }
  return { status: 'unknown', message: UNKNOWN };
}

export async function createYaohuoTopic({
  input,
  ...options
}: Options & { input: CreateTopicInput }): Promise<CreateTopicResult> {
  const { draft, body } = input;
  if (draft.source !== 'yaohuo' || !/^\d+$/.test(draft.categoryId) || !draft.title.trim() || !body.trim())
    throw new Error('妖火发帖内容或版块不正确');
  const path = PATHS[draft.kind];
  const count =
    draft.kind === 'poll'
      ? draft.poll.options.length
      : draft.kind === 'resources'
        ? draft.resources.length
        : draft.attachments.filter((file) => file.kind === 'yaohuo-file').length;
  const page = await readPage(
    `${path}?classid=${encodeURIComponent(draft.categoryId)}${draft.kind === 'resources' ? `&num=${count}` : ''}`,
    options
  );
  const form = page.root.querySelectorAll('form').find((candidate) => {
    try {
      return (
        new URL(
          requireYaohuoRequestUrl(decodeHtml(candidate.getAttribute('action') || page.url), page.url)
        ).pathname.toLowerCase() === path &&
        candidate.getAttribute('method')?.toLowerCase() === 'post' &&
        candidate.querySelector('[name="classid"]')?.getAttribute('value') === draft.categoryId &&
        Boolean(candidate.querySelector('[name="book_title"]')) &&
        Boolean(candidate.querySelector('[name="book_content"]'))
      );
    } catch {
      return false;
    }
  });
  if (!form) throw new Error('妖火未返回匹配的发帖表单，请刷新后重试');
  const fileAccept = form.querySelector('input[type="file"]')?.getAttribute('accept') || '';
  const errors = validateTopicDraft(
    { ...draft, body },
    {
      source: 'yaohuo',
      categories: [{ id: draft.categoryId, name: '' }],
      kinds: [draft.kind],
      allowedFileExtensions: fileAccept
        .split(',')
        .map((value) => value.trim().replace(/^\./, '').toLowerCase())
        .filter(Boolean),
      titleMin: numberAttribute(form, '[name="book_title"]', 'minlength') ?? 5,
      titleMax: numberAttribute(form, '[name="book_title"]', 'maxlength') ?? 50,
      bodyMin: numberAttribute(form, '[name="book_content"]', 'minlength') ?? 15,
      bodyMax: numberAttribute(form, '[name="book_content"]', 'maxlength')
    }
  );
  if (Object.keys(errors).length) throw new Error(Object.values(errors).join('；'));
  const action = requireYaohuoRequestUrl(decodeHtml(form.getAttribute('action') || page.url), page.url);
  const fields = new URLSearchParams();
  for (const field of form.querySelectorAll('input[type="hidden"]')) {
    const name = field.getAttribute('name');
    if (name && !field.hasAttribute('disabled')) fields.append(name, field.getAttribute('value') || '');
  }
  fields.set('book_title', draft.title.trim());
  fields.set('book_content', body.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n'));
  const submit = form.querySelector('button[type="submit"][name], input[type="submit"][name]');
  if (submit) fields.set(submit.getAttribute('name')!, submit.getAttribute('value') || '');
  if (draft.kind === 'normal') fields.set('sendmoney', draft.reward.trim());
  if (draft.kind === 'gift' || (draft.kind === 'poll' && draft.poll.giftEnabled)) {
    const gift = draft.kind === 'gift' ? draft.gift : draft.poll;
    fields.set('freemoney', gift.total.trim());
    fields.set('freerule2', gift.perPerson.trim());
  }
  if (draft.kind === 'poll') {
    fields.set('displayNum', String(count));
    fields.set('num', String(count));
    fields.delete('vote');
    draft.poll.options.forEach((option) => fields.append('vote', option.trim()));
  }
  if (draft.kind === 'resources') {
    fields.set('displayNum', String(count));
    fields.set('num', String(count));
    for (const resource of draft.resources) {
      fields.append('file_title', resource.title.trim());
      fields.append('file_url', resource.url.trim());
      fields.append('file_size', resource.size);
      fields.append('file_ext', resource.extension);
      fields.append('file_info', resource.description);
    }
  }
  let requestBody: string | FormData = fields.toString();
  if (draft.kind === 'files') {
    if (count < 1 || count > 9 || form.getAttribute('enctype')?.toLowerCase() !== 'multipart/form-data')
      throw new Error('妖火文件表单不正确，或文件数量超出 1–9 个');
    fields.set('num', String(count));
    const multipart = new FormData();
    for (const [name, value] of fields) multipart.append(name, value);
    for (const file of draft.attachments.filter((item) => item.kind === 'yaohuo-file')) {
      appendFileToFormData(multipart, 'book_file', file);
      multipart.append('book_file_info', file.description);
    }
    requestBody = multipart;
  }
  const response = await fetchWithTimeout(
    action,
    withBrowserFetchIntent(
      {
        method: 'POST',
        headers: {
          ...YAOHUO_ACTION_HEADERS,
          'user-agent': options.userAgent,
          referer: page.url,
          ...(typeof requestBody === 'string' ? { 'content-type': 'application/x-www-form-urlencoded' } : {})
        },
        body: requestBody
      },
      { owner: 'write', priority: 'write' }
    ),
    { fetcher: options.fetcher, signal: options.signal }
  );
  const html = await response.text();
  if (response.url) {
    try {
      requireYaohuoRequestUrl(response.url);
    } catch {
      return { status: 'unknown', message: UNKNOWN };
    }
  }
  return postingResult(html, response, input);
}
