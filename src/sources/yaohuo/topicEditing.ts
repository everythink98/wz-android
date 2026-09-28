import { decodeHtml, elementText, parseHtml, textContentFromHtml } from '@/domain/forum/html';
import {
  type TopicDraft,
  topicEditConflict,
  validateTopicEdit,
  type TopicEditContext,
  type TopicEditResult
} from '@/domain/forum/topicComposer';
import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import { withBrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import { YAOHUO_ACTION_HEADERS } from './actionClient';
import { requireYaohuoRequestUrl, extractYaohuoUserIdFromHref } from './protocol';
import { yaohuoLoginRequirementReason } from './sessionParser';

type Options = { fetcher: Fetcher; userAgent: string; signal?: AbortSignal };
const EDIT_PATH = '/bbs/book_view_mod.aspx';
async function page(path: string, options: Options) {
  const url = requireYaohuoRequestUrl(path);
  const response = await fetchWithTimeout(
    url,
    withBrowserFetchIntent(
      {
        headers: {
          ...YAOHUO_ACTION_HEADERS,
          'user-agent': options.userAgent,
          'cache-control': 'no-cache'
        }
      },
      { owner: 'topic', priority: 'foreground' }
    ),
    options
  );
  const html = await response.text();
  if (yaohuoLoginRequirementReason(html, response.url))
    throw Object.assign(new Error('请重新确认妖火登录状态'), { source: 'yaohuo', loginRequired: true });
  if (!response.ok) throw new Error(`妖火编辑表单读取失败：HTTP ${response.status}`);
  if (response.url) requireYaohuoRequestUrl(response.url);
  return { root: parseHtml(html), url };
}

async function editForm(options: Options & { topicId: string; identityKey: string }) {
  const { topicId, identityKey } = options;
  if (!/^\d+$/.test(topicId)) throw new Error('帖子 ID 不正确');
  const topic = await page(`/bbs-${topicId}.html`, options);
  const authorHref =
    topic.root
      .querySelector('div.subtitle a[href*="userinfo"], div.subtitle a[href*="touserid"]')
      ?.getAttribute('href') || '';
  const authorId = extractYaohuoUserIdFromHref(decodeHtml(authorHref));
  if (!authorId || identityKey !== `yaohuo:${authorId}`) throw new Error('只能编辑本人主帖');
  const links = topic.root
    .querySelectorAll('a[href]')
    .filter((link) => !link.closest('.bbscontent, .recontent, blockquote'));
  const editLink = links.find((link) => (link.getAttribute('href') || '').includes('book_view_mod.aspx'));
  const classId = links
    .map((link) => decodeHtml(link.getAttribute('href') || '').match(/[?&]classid=(\d+)/)?.[1])
    .find(Boolean);
  const path = editLink
    ? requireYaohuoRequestUrl(decodeHtml(editLink.getAttribute('href')!), topic.url)
    : `${EDIT_PATH}?action=go&id=${topicId}&siteid=1000${classId ? `&classid=${classId}` : ''}&lpage=1`;
  const formPage = await page(path, options);
  const form = formPage.root.querySelector('form');
  const action = requireYaohuoRequestUrl(decodeHtml(form?.getAttribute('action') || ''), formPage.url);
  if (
    !form ||
    new URL(action).pathname.toLowerCase() !== EDIT_PATH ||
    form.getAttribute('method')?.toLowerCase() !== 'post'
  )
    throw new Error('原站未提供主帖修改表单');
  const fields = new URLSearchParams();
  for (const input of form.querySelectorAll('input[type="hidden"][name]')) {
    const name = input.getAttribute('name')!;
    if (['action', 'id', 'classid', 'siteid', 'lpage', 'token'].includes(name))
      fields.set(name, input.getAttribute('value') || '');
  }
  const title = form.querySelector('input[name="book_title"]');
  const body = form.querySelector('textarea[name="book_content"]');
  if (fields.get('id') !== topicId || !fields.get('token') || !title || !body)
    throw new Error('原站未返回目标帖子的完整修改表单');
  const categoryId = fields.get('classid') || '';
  const context: TopicEditContext = {
    source: 'yaohuo',
    topicId,
    identityKey,
    original: { title: title.getAttribute('value') || '', body: decodeHtml(body.rawText), categoryId },
    permissions: {
      title: true,
      body: true,
      categoryId: false,
      rank: false,
      tags: false,
      additionalReward: Boolean(form.querySelector('[name="additionalReward"]'))
    },
    rules: {
      source: 'yaohuo',
      categories: [{ id: categoryId, name: categoryId }],
      kinds: ['normal'],
      allowedFileExtensions: [],
      titleMax: Number(title.getAttribute('maxlength')) || 50
    }
  };
  return { context, fields, action };
}

export async function loadYaohuoTopicEditContext(options: Options & { topicId: string; identityKey: string }) {
  return (await editForm(options)).context;
}

export async function editYaohuoTopic(options: Options & { draft: TopicDraft }): Promise<TopicEditResult> {
  const { draft } = options;
  if (draft.source !== 'yaohuo' || !draft.edit) throw new Error('妖火编辑目标不正确');
  const target = { ...options, topicId: draft.edit.topicId, identityKey: draft.identityKey };
  const { context, fields, action } = await editForm(target);
  const errors = validateTopicEdit(draft, context);
  if (Object.keys(errors).length) return { status: 'rejected', message: Object.values(errors).join('；') };
  if (topicEditConflict(draft.edit.original, context.original))
    return { status: 'conflict', message: '原站内容已变化，请核对最新内容', latest: context.original };
  fields.set('book_title', draft.title);
  fields.set('book_content', draft.body);
  if (draft.additionalReward) fields.set('additionalReward', draft.additionalReward);
  const response = await fetchWithTimeout(
    action,
    withBrowserFetchIntent(
      {
        method: 'POST',
        headers: {
          ...YAOHUO_ACTION_HEADERS,
          'user-agent': options.userAgent,
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: fields.toString()
      },
      { owner: 'write', priority: 'write' }
    ),
    options
  );
  const html = await response.text();
  if (yaohuoLoginRequirementReason(html, response.url)) return { status: 'rejected', message: '妖火要求重新登录' };
  const root = parseHtml(html);
  const message = elementText(root.querySelector('.tip')) || textContentFromHtml(html);
  if (message.length <= 200 && /失败|权限不足|重复提交|错误|禁止|无权|不允许|不能为空|不足|最少|最多/.test(message))
    return { status: 'rejected', message };
  if (
    response.ok &&
    /^(?:修改|编辑)(?:帖子|主题)?成功[！!。\s]*(?:跳转中[.。…]*\s*)?(?:返回|查看帖子|查看主题)?$/.test(message)
  )
    return { status: 'saved', message: '修改已保存' };
  if (!draft.additionalReward && response.ok) {
    try {
      const latest = await loadYaohuoTopicEditContext(target);
      if (latest.original.title === draft.title && latest.original.body === draft.body)
        return { status: 'saved', message: '已回读确认修改' };
    } catch {
      /* A failed read cannot prove whether the preceding write succeeded. */
    }
  }
  return { status: 'unknown', message: '妖火未确认保存结果，请到原站核对；不要重复追加悬赏' };
}
