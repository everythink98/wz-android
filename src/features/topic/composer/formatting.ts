import type { Source } from '@/domain/forum/models';
import { sourceSupportsTopicAction } from '@/domain/forum/sourceCatalog';

export type ReplyComposerFormatAction = 'bold' | 'italic' | 'heading' | 'link' | 'image' | 'quote' | 'code' | 'list';
export type ReplyComposerAccessory = 'nodeseek-sticker' | 'discourse-emoji' | 'yaohuo-face';

type ReplyComposerToolbarItem =
  | { type: 'format'; action: ReplyComposerFormatAction; label: string }
  | { type: 'accessory'; accessory: ReplyComposerAccessory; label: string };

const REPLY_COMPOSER_ACCESSORIES: Partial<Record<Source, ReplyComposerAccessory>> = {
  nodeseek: 'nodeseek-sticker',
  linuxdo: 'discourse-emoji',
  xiaoyinsi: 'discourse-emoji',
  yaohuo: 'yaohuo-face'
};

type Selection = {
  start: number;
  end: number;
};

function selectedText(content: string, selection?: Selection) {
  if (!selection) {
    return '';
  }
  const start = Math.max(0, Math.min(selection.start, content.length));
  const end = Math.max(start, Math.min(selection.end, content.length));
  return content.slice(start, end);
}

export function replaceReplyComposerSelection(content: string, selection: Selection | undefined, value: string) {
  if (!selection) {
    return `${content}${content && !content.endsWith('\n') ? '\n' : ''}${value}`;
  }
  const start = Math.max(0, Math.min(selection.start, content.length));
  const end = Math.max(start, Math.min(selection.end, content.length));
  return `${content.slice(0, start)}${value}${content.slice(end)}`;
}

export function replyComposerKeepsAccessoryOpenAfterExpressionInsert(accessory: ReplyComposerAccessory) {
  return accessory === 'nodeseek-sticker' || accessory === 'discourse-emoji';
}

export function replyComposerExpressionGridKey(accessory: ReplyComposerAccessory, categoryLabel = '') {
  return categoryLabel ? `${accessory}:${categoryLabel}` : accessory;
}

function linePrefix(text: string, prefix: string, fallback: string) {
  const value = text || fallback;
  return value
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function markdownValue(action: ReplyComposerFormatAction, text: string) {
  switch (action) {
    case 'bold':
      return `**${text || '粗体'}**`;
    case 'italic':
      return `*${text || '斜体'}*`;
    case 'heading':
      return linePrefix(text, '## ', '标题');
    case 'link':
      return `[${text || '链接文字'}](https://)`;
    case 'image':
      return `![${text || '图片描述'}](https://)`;
    case 'quote':
      return linePrefix(text, '> ', '引用内容');
    case 'code':
      return text.includes('\n') ? `\`\`\`\n${text}\n\`\`\`` : `\`${text || '代码'}\``;
    case 'list':
      return linePrefix(text, '- ', '列表项');
  }
}

function ubbValue(action: ReplyComposerFormatAction, text: string) {
  switch (action) {
    case 'bold':
      return `[b]${text || '粗体'}[/b]`;
    case 'italic':
      return `[i]${text || '斜体'}[/i]`;
    case 'heading':
      return `[b]${text || '标题'}[/b]`;
    case 'link':
      return `[url=https://]${text || '链接文字'}[/url]`;
    case 'image':
      return `[img]${text || 'https://'}[/img]`;
    case 'quote':
      return `[quote]${text || '引用内容'}[/quote]`;
    case 'code':
      return `[code]${text || '代码'}[/code]`;
    case 'list':
      return `[list]\n[*]${text || '列表项'}\n[/list]`;
  }
}

export function applyReplyComposerFormat({
  action,
  content,
  selection,
  source
}: {
  action: ReplyComposerFormatAction;
  content: string;
  selection?: Selection;
  source?: Source;
}) {
  const text = selectedText(content, selection);
  const formatted = source === 'yaohuo' ? ubbValue(action, text) : markdownValue(action, text);
  return replaceReplyComposerSelection(content, selection, formatted);
}

function replyComposerFormatActions(source?: Source): { action: ReplyComposerFormatAction; label: string }[] {
  if (!sourceSupportsTopicAction(source, 'reply')) {
    return [];
  }
  return [
    { action: 'bold', label: 'B' },
    { action: 'italic', label: 'I' },
    ...(source === 'yaohuo' ? [] : [{ action: 'heading' as const, label: '标题' }]),
    { action: 'link', label: '链接' },
    { action: 'image', label: '图片' },
    { action: 'quote', label: '引用' },
    { action: 'code', label: '代码' },
    { action: 'list', label: '列表' }
  ];
}

export function replyComposerToolbarItems(source?: Source): ReplyComposerToolbarItem[] {
  const formatActions = replyComposerFormatActions(source);
  if (!formatActions.length) {
    return [];
  }
  const accessory = source ? REPLY_COMPOSER_ACCESSORIES[source] : undefined;
  return [
    ...(accessory ? [{ type: 'accessory' as const, accessory, label: '表情' }] : []),
    ...formatActions.map((item) => ({ type: 'format' as const, ...item }))
  ];
}
