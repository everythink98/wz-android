import {
  Extension,
  Node as TiptapNode,
  findParentNodeClosestToPos,
  mergeAttributes,
  type Editor as TiptapEditor
} from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import { NodeSelection, Plugin, Selection, TextSelection } from '@tiptap/pm/state';
import { selectedRect } from '@tiptap/pm/tables';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { StarterKit } from '@tiptap/starter-kit';
import { Table, TableKit, renderTableToMarkdown } from '@tiptap/extension-table';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import { Image } from '@tiptap/extension-image';
import { EditorState, Transaction as CodeMirrorTransaction } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { markdown as markdownLanguage } from '@codemirror/lang-markdown';
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands';
import DOMPurify from 'dompurify';
import { createRoot } from 'react-dom/client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './editorRuntime.css';
import {
  generateNodeSeekStardustRefId,
  nodeSeekPendingPollIdFromToken,
  nodeSeekPendingPollToken,
  nodeSeekPendingPollTokenRanges,
  nodeSeekRemotePollMarkerRanges,
  nodeSeekStardustMarkerRanges,
  normalizeNodeSeekStardustRefId,
  normalizePendingNodeSeekPoll,
  parseNodeSeekStardustReceive,
  serializeNodeSeekStardustReceive,
  type ComposerMode,
  type ComposerSnapshot,
  type ComposerValidationIssue,
  type PendingNodeSeekPoll
} from '@/domain/forum/structuredComposer';
import {
  emptyLinuxDoPoll,
  parseLinuxDoPoll,
  serializeLinuxDoPoll,
  type LinuxDoPollCapabilities,
  type LinuxDoPollDraft
} from '@/domain/forum/linuxDoPoll';
import { NODESEEK_STICKER_CATEGORIES, nodeSeekStickerForCode } from '@/domain/forum/nodeSeekStickers';
import { useCommittedRef, useCommitRefValue } from '@/ui/hooks/useCommittedRef';
import {
  composerHostMessageSchema,
  linuxDoPollCapabilitiesSchema,
  MAX_COMPOSER_MARKDOWN_LENGTH,
  type ComposerHostMessage
} from './structuredComposerBridge';
import {
  EditorButton,
  EditorCard,
  EditorCardBody,
  EditorCardHeader,
  EditorDropdown,
  EditorDropdownCheckboxItem,
  EditorDropdownItem,
  EditorDropdownRadioGroup,
  EditorDropdownRadioItem,
  EditorInput,
  EditorLinkPopover,
  EditorSeparator,
  EditorToolbar
} from './tiptapUi';

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (value: string) => void };
  }
}

type RuntimeConfig = Extract<ComposerHostMessage, { type: 'INIT' }>['payload'];
type RuntimeTheme = RuntimeConfig['theme'];
type TemplateSummary = { id: string; title: string; content: string };
type ComposerBuilder =
  'nodeseek-poll' | 'stardust' | 'linuxdo-poll' | 'private' | 'templates' | 'stickers' | 'emoji' | null;

type ExpressionStorage = {
  config: RuntimeConfig | null;
  refreshers: Set<() => void>;
};

function renderExpressionNode(dom: HTMLSpanElement, raw: string, config: RuntimeConfig | null) {
  const preview = expressionPreview(config, raw);
  dom.replaceChildren();
  dom.dataset.composerNode = 'forum-expression';
  dom.contentEditable = 'false';
  if (!preview) {
    dom.className = 'expression-token';
    dom.removeAttribute('role');
    dom.removeAttribute('aria-label');
    dom.textContent = raw;
    return;
  }
  dom.className = `expression-media expression-${preview.presentation}`;
  dom.setAttribute('role', 'img');
  dom.setAttribute('aria-label', preview.label || raw);
  const image = document.createElement('img');
  image.alt = '';
  image.decoding = 'async';
  image.draggable = false;
  image.loading = 'lazy';
  image.src = preview.imageUrl;
  dom.append(image);
}

const ForumExpressionNode = TiptapNode.create<Record<string, never>, ExpressionStorage>({
  name: 'forumExpression',
  inline: true,
  group: 'inline',
  atom: true,
  priority: 1_000,
  addStorage() {
    return { config: null, refreshers: new Set() };
  },
  addAttributes() {
    return { raw: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'span[data-composer-node="forum-expression"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const raw = String(node.attrs.raw || '');
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'expression-token',
        'data-composer-node': 'forum-expression',
        contenteditable: 'false'
      }),
      raw
    ];
  },
  addNodeView() {
    return ({ node }) => {
      let currentNode = node;
      const dom = document.createElement('span');
      const refresh = () => renderExpressionNode(dom, String(currentNode.attrs.raw || ''), this.storage.config);
      this.storage.refreshers.add(refresh);
      refresh();
      return {
        dom,
        update: (nextNode) => {
          if (nextNode.type.name !== this.name) return false;
          currentNode = nextNode;
          refresh();
          return true;
        },
        destroy: () => this.storage.refreshers.delete(refresh)
      };
    };
  },
  markdownTokenName: 'forumExpression',
  markdownTokenizer: {
    name: 'forumExpression',
    level: 'inline',
    start: (source) => source.search(/:[A-Za-z0-9][A-Za-z0-9_+-]{0,99}:/),
    tokenize(source) {
      const match = source.match(/^:[A-Za-z0-9][A-Za-z0-9_+-]{0,99}:/);
      return match ? { type: 'forumExpression', raw: match[0] } : undefined;
    }
  },
  parseMarkdown(token, helpers) {
    return helpers.createNode('forumExpression', { raw: token.raw });
  },
  renderMarkdown(node) {
    return String(node.attrs?.raw || '');
  }
});

type ExpressionPreview = { imageUrl: string; label: string; presentation: 'emoji' | 'sticker' };

function expressionPreview(config: RuntimeConfig | null, raw: string): ExpressionPreview | null {
  if (config?.site === 'nodeseek') {
    const sticker = nodeSeekStickerForCode(raw);
    return sticker ? { imageUrl: sticker.imageUrl, label: sticker.label, presentation: 'sticker' } : null;
  }
  if (config?.site === 'linuxdo') {
    const name = raw.slice(1, -1);
    const emoji = config.discourseEmoji.find((item) => item.name === name);
    return emoji ? { imageUrl: emoji.url, label: name.replace(/_/g, ' '), presentation: 'emoji' } : null;
  }
  return null;
}

function setExpressionConfig(editor: TiptapEditor | null, config: RuntimeConfig | null) {
  if (!editor) return;
  const storage = (editor.storage as unknown as Record<string, unknown>).forumExpression as ExpressionStorage;
  storage.config = config;
  storage.refreshers.forEach((refresh) => refresh());
}

function syncEditorEmptyState(editor: TiptapEditor) {
  const firstChild = editor.state.doc.firstChild;
  editor.view.dom.dataset.empty =
    editor.state.doc.childCount === 1 && firstChild?.isTextblock && firstChild.content.size === 0 ? 'true' : 'false';
}

function replaceRichMarkdownDocument(editor: TiptapEditor | null, markdown: string) {
  if (!editor) return;
  editor
    .chain()
    .setMeta('addToHistory', false)
    .setContent(markdown, { contentType: 'markdown', emitUpdate: false })
    .run();
  syncEditorEmptyState(editor);
}

const pendingPolls = new Map<string, PendingNodeSeekPoll>();
const hostActionResolvers = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

function postMessage(type: string, payload: unknown) {
  window.ReactNativeWebView?.postMessage(JSON.stringify({ type, payload }));
}

function runtimeError(code: string, message: string, revision: number) {
  postMessage('ERROR', { code, message: message.slice(0, 300), revision });
}

function requestHostAction(
  action: 'upload-image' | 'load-linuxdo-templates' | 'use-linuxdo-template' | 'load-linuxdo-poll-capabilities',
  data?: unknown
) {
  const requestId = `host-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  postMessage('REQUEST_HOST_ACTION', { requestId, action, ...(data === undefined ? {} : { data }) });
  return new Promise<unknown>((resolve, reject) => hostActionResolvers.set(requestId, { resolve, reject }));
}

function replaceCodeMirrorDocument(view: EditorView, value: string) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: value },
    selection: { anchor: Math.min(value.length, view.state.selection.main.head) },
    annotations: CodeMirrorTransaction.addToHistory.of(false)
  });
}

function markdownTokenFromStart(source: string, prefix: string) {
  if (!source.startsWith(prefix)) return null;
  let end = prefix.length;
  while (end < source.length && !/[\s<>"']/u.test(source[end]!)) end += 1;
  return source.slice(0, end);
}

const PendingNodeSeekPollNode = TiptapNode.create({
  name: 'pendingNodeSeekPoll',
  group: 'block',
  atom: true,
  isolating: true,
  addAttributes() {
    return {
      localId: { default: '' },
      title: { default: '' },
      multiple: { default: false },
      isPublic: { default: false },
      options: { default: '[]' },
      fingerprint: { default: '' },
      remoteId: { default: '' }
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-composer-node="pending-nodeseek-poll"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    let options: string[];
    try {
      options = JSON.parse(String(node.attrs.options || '[]'));
    } catch {
      options = [];
    }
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        class: 'tiptap-card private-card poll-card',
        'data-composer-node': 'pending-nodeseek-poll',
        contenteditable: 'false'
      }),
      ['strong', {}, String(node.attrs.title || 'NodeSeek 投票')],
      [
        'span',
        { class: 'card-meta' },
        `${node.attrs.multiple ? '多选' : '单选'} · ${node.attrs.isPublic ? '公开' : '匿名'}`
      ],
      ['span', { class: 'card-body' }, options.map((option) => `○ ${option}`).join('\n')]
    ];
  },
  markdownTokenName: 'pendingNodeSeekPoll',
  markdownTokenizer: {
    name: 'pendingNodeSeekPoll',
    level: 'block',
    start: (source) => source.indexOf('<!-- wz:nodeseek-poll:'),
    tokenize(source) {
      const suffix = ' -->';
      if (!source.startsWith('<!-- wz:nodeseek-poll:')) return undefined;
      const end = source.indexOf(suffix);
      if (end < 0) return undefined;
      const raw = source.slice(0, end + suffix.length);
      const localId = nodeSeekPendingPollIdFromToken(raw);
      return localId ? { type: 'pendingNodeSeekPoll', raw, localId } : undefined;
    }
  },
  parseMarkdown(token, helpers) {
    const localId = String(token.localId || '');
    const poll = pendingPolls.get(localId);
    return helpers.createNode('pendingNodeSeekPoll', {
      localId,
      title: poll?.title || '待发布投票',
      multiple: poll?.multiple || false,
      isPublic: poll?.isPublic || false,
      options: JSON.stringify(poll?.options || []),
      fingerprint: poll?.fingerprint || '',
      remoteId: poll?.remoteId || ''
    });
  },
  renderMarkdown(node) {
    return nodeSeekPendingPollToken(String(node.attrs?.localId || ''));
  }
});

const NodeSeekRemotePollNode = TiptapNode.create({
  name: 'nodeSeekRemotePoll',
  group: 'block',
  atom: true,
  isolating: true,
  addAttributes() {
    return { pollId: { default: '' }, raw: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-composer-node="nodeseek-remote-poll"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        class: 'tiptap-card private-card poll-card readonly-card',
        'data-composer-node': 'nodeseek-remote-poll',
        contenteditable: 'false'
      }),
      ['strong', {}, '已发布的 NodeSeek 投票'],
      ['span', { class: 'card-meta' }, `投票 #${String(node.attrs.pollId || '')} · 只读，可删除`]
    ];
  },
  markdownTokenName: 'nodeSeekRemotePoll',
  markdownTokenizer: {
    name: 'nodeSeekRemotePoll',
    level: 'block',
    start: (source) => source.indexOf('nsapp://vote?id='),
    tokenize(source) {
      const match = source.match(/^nsapp:\/\/vote\?id=(\d+)/);
      return match ? { type: 'nodeSeekRemotePoll', raw: match[0], pollId: match[1] } : undefined;
    }
  },
  parseMarkdown(token, helpers) {
    return helpers.createNode('nodeSeekRemotePoll', { pollId: token.pollId, raw: token.raw });
  },
  renderMarkdown(node) {
    return String(node.attrs?.raw || `nsapp://vote?id=${node.attrs?.pollId || ''}`);
  }
});

const NodeSeekStardustNode = TiptapNode.create({
  name: 'nodeSeekStardust',
  group: 'block',
  atom: true,
  isolating: true,
  addAttributes() {
    return {
      receiverMemberId: { default: '' },
      amount: { default: 0 },
      refId: { default: 0 },
      description: { default: '' },
      oneTime: { default: false },
      rawMarker: { default: '' },
      modified: { default: false }
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-composer-node="nodeseek-stardust"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        class: 'tiptap-card private-card stardust-card',
        'data-composer-node': 'nodeseek-stardust',
        contenteditable: 'false'
      }),
      ['strong', {}, `${node.attrs.amount} Stardust 收款卡片`],
      ['span', { class: 'card-meta' }, `收款人 #${node.attrs.receiverMemberId} · Ref ${node.attrs.refId}`],
      ['span', { class: 'card-body' }, String(node.attrs.description || '')],
      ['span', { class: 'card-meta' }, node.attrs.oneTime ? '一次性付款' : '允许多次付款']
    ];
  },
  markdownTokenName: 'nodeSeekStardust',
  markdownTokenizer: {
    name: 'nodeSeekStardust',
    level: 'block',
    start: (source) => source.indexOf('nsapp://stardust-receive?'),
    tokenize(source) {
      const raw = markdownTokenFromStart(source, 'nsapp://stardust-receive?');
      if (!raw) return undefined;
      const receive = parseNodeSeekStardustReceive(raw);
      return receive ? { type: 'nodeSeekStardust', raw, receive } : undefined;
    }
  },
  parseMarkdown(token, helpers) {
    const receive = token.receive as ReturnType<typeof parseNodeSeekStardustReceive>;
    return helpers.createNode('nodeSeekStardust', { ...receive, modified: false });
  },
  renderMarkdown(node) {
    if (!node.attrs?.modified && node.attrs?.rawMarker) return String(node.attrs.rawMarker);
    return serializeNodeSeekStardustReceive({
      receiverMemberId: String(node.attrs?.receiverMemberId || ''),
      amount: Number(node.attrs?.amount),
      refId: Number(node.attrs?.refId),
      description: String(node.attrs?.description || ''),
      oneTime: Boolean(node.attrs?.oneTime)
    });
  }
});

type PrivateBlock = { kind: string; raw: string };

function asciiLowerCase(text: string) {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function privateBlockFromStart(source: string): PrivateBlock | null {
  const lowerSource = asciiLowerCase(source);
  for (const [opening, closing, kind] of [
    ['[poll', '[/poll]', 'linuxdo-poll'],
    ['[details', '[/details]', 'details'],
    ['[spoiler', '[/spoiler]', 'spoiler'],
    ['[math', '[/math]', 'formula'],
    ['[wrap=', '[/wrap]', 'scrolling']
  ] as const) {
    if (!lowerSource.startsWith(opening)) continue;
    const closeAt = lowerSource.indexOf(closing, opening.length);
    if (closeAt >= 0) return { kind, raw: source.slice(0, closeAt + closing.length) };
  }
  if (source.startsWith('$$')) {
    const closeAt = source.indexOf('$$', 2);
    if (closeAt >= 0) return { kind: 'formula', raw: source.slice(0, closeAt + 2) };
  }
  if (source.startsWith(':::')) {
    const lineEnd = source.indexOf('\n');
    const closeAt = source.indexOf('\n:::', lineEnd < 0 ? 3 : lineEnd);
    if (closeAt >= 0) return { kind: 'private-block', raw: source.slice(0, closeAt + 4) };
  }
  const fenced = source.match(/^```(mermaid|chart|graphviz)\b[^\n]*\n[\s\S]*?\n```(?=\n|$)/i);
  if (fenced) return { kind: fenced[1]!.toLowerCase(), raw: fenced[0] };
  for (const marker of ['[toc]', '<!-- toc -->']) {
    if (lowerSource.startsWith(marker)) return { kind: 'toc', raw: source.slice(0, marker.length) };
  }
  const unknownPair = source.match(/^\[([a-z][\w-]*)(?:[^\]\n]*)\][\s\S]*?\[\/\1\](?=\n|$)/i);
  if (unknownPair) return { kind: 'private-block', raw: unknownPair[0] };
  const unknownSingle = source.match(/^\[(?!date=)[a-z][^\]\n]*\](?=\n|$)/i);
  if (unknownSingle) return { kind: 'private-block', raw: unknownSingle[0] };
  return null;
}

function privateBlockStart(source: string) {
  const lowerSource = asciiLowerCase(source);
  const candidates = [
    '[poll',
    '[details',
    '[spoiler',
    '[math',
    '[wrap=',
    '$$',
    ':::',
    '```mermaid',
    '```chart',
    '```graphviz',
    '[toc]',
    '<!-- toc -->'
  ]
    .map((prefix) => lowerSource.indexOf(prefix))
    .filter((index) => index >= 0);
  const unknown = source.search(/^\[(?!date=)[a-z][^\]\n]*\](?:\n|$)/im);
  if (unknown >= 0) candidates.push(unknown);
  return candidates.length ? Math.min(...candidates) : -1;
}

function privateBlockPresentation(kind: string, raw: string) {
  if (kind === 'linuxdo-poll') {
    const poll = parseLinuxDoPoll(raw);
    if (!poll) return { title: 'LinuxDo 投票', body: raw };
    const typeLabel = {
      regular: '单选',
      multiple: '多选',
      number: '数字',
      ranked_choice: '排序选择'
    }[poll.type];
    const resultsLabel = {
      always: '结果始终可见',
      on_vote: '投票后显示结果',
      on_close: '关闭后显示结果',
      staff_only: '结果仅 Staff 可见'
    }[poll.results];
    const body =
      poll.type === 'number'
        ? `范围 ${poll.min}–${poll.max} · 步长 ${poll.step}`
        : poll.options
            .map((option, index) =>
              poll.type === 'ranked_choice'
                ? `${index + 1}. ${option}`
                : `${poll.type === 'multiple' ? '□' : '○'} ${option}`
            )
            .join('\n');
    return {
      title: poll.title || 'LinuxDo 投票',
      meta: [
        typeLabel,
        poll.publicPoll ? '显示投票人' : '不显示投票人',
        resultsLabel,
        poll.groups.length ? `用户组：${poll.groups.join('、')}` : '',
        poll.close ? `关闭：${poll.close}` : ''
      ]
        .filter(Boolean)
        .join(' · '),
      body
    };
  }
  if (kind === 'details') {
    const summary = raw.slice(0, raw.indexOf(']') + 1).match(/=["']?([^\]"']+)/)?.[1] || '详情';
    return {
      title: `详情 · ${summary}`,
      body: raw.slice(raw.indexOf(']') + 1, asciiLowerCase(raw).lastIndexOf('[/details]')).trim()
    };
  }
  if (kind === 'spoiler') return { title: '剧透内容', body: '点击源码模式查看或编辑隐藏内容' };
  if (kind === 'formula')
    return {
      title: '公式',
      body: raw
        .replace(/^\$\$|\$\$$/g, '')
        .replace(/^\[math[^\]]*\]|\[\/math\]$/gi, '')
        .trim()
    };
  const labels: Record<string, string> = {
    scrolling: '滚动内容',
    toc: '目录',
    mermaid: 'Mermaid',
    chart: 'Build Chart',
    graphviz: 'Graphviz',
    'private-block': '站点私有块'
  };
  return { title: labels[kind] || '站点私有块', body: raw };
}

const ForumPrivateBlockNode = TiptapNode.create({
  name: 'forumPrivateBlock',
  group: 'block',
  atom: true,
  isolating: true,
  addAttributes() {
    return { kind: { default: 'private-block' }, raw: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-composer-node="forum-private-block"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const presentation = privateBlockPresentation(String(node.attrs.kind), String(node.attrs.raw));
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        class: `tiptap-card private-card private-${String(node.attrs.kind)}`,
        'data-composer-node': 'forum-private-block',
        contenteditable: 'false'
      }),
      ['strong', {}, presentation.title],
      ...(presentation.meta ? ([['span', { class: 'card-meta' }, presentation.meta]] as const) : []),
      ['span', { class: 'card-body' }, presentation.body]
    ];
  },
  markdownTokenName: 'forumPrivateBlock',
  markdownTokenizer: {
    name: 'forumPrivateBlock',
    level: 'block',
    start: privateBlockStart,
    tokenize(source) {
      const block = privateBlockFromStart(source);
      return block ? { type: 'forumPrivateBlock', raw: block.raw, kind: block.kind } : undefined;
    }
  },
  parseMarkdown(token, helpers) {
    return helpers.createNode('forumPrivateBlock', { kind: token.kind, raw: token.raw });
  },
  renderMarkdown(node) {
    return String(node.attrs?.raw || '');
  }
});

const LinuxDoDateNode = TiptapNode.create({
  name: 'linuxdoDate',
  inline: true,
  group: 'inline',
  atom: true,
  priority: 1_000,
  addAttributes() {
    return { raw: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'span[data-composer-node="linuxdo-date"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const raw = String(node.attrs.raw || '');
    const date = raw.match(/\bdate=([^\s\]]+)/i)?.[1] || '';
    const time = raw.match(/\btime=([^\s\]]+)/i)?.[1] || '';
    const value = [date, time].filter(Boolean).join(' ');
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'private-inline',
        'data-composer-node': 'linuxdo-date',
        contenteditable: 'false',
        title: raw
      }),
      `日期${value ? ` · ${value}` : ''}`
    ];
  },
  markdownTokenName: 'linuxdoDate',
  markdownTokenizer: {
    name: 'linuxdoDate',
    level: 'inline',
    start: (source) => source.indexOf('[date='),
    tokenize(source) {
      const match = source.match(/^\[date=[^\]\n]+\]/i);
      return match ? { type: 'linuxdoDate', raw: match[0] } : undefined;
    }
  },
  parseMarkdown(token, helpers) {
    return helpers.createNode('linuxdoDate', { raw: token.raw });
  },
  renderMarkdown(node) {
    return String(node.attrs?.raw || '');
  }
});

const LinuxDoFootnoteReferenceNode = TiptapNode.create({
  name: 'linuxdoFootnoteReference',
  inline: true,
  group: 'inline',
  atom: true,
  priority: 1_000,
  addAttributes() {
    return { raw: { default: '' }, label: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'span[data-composer-node="linuxdo-footnote-reference"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'private-inline',
        'data-composer-node': 'linuxdo-footnote-reference',
        contenteditable: 'false'
      }),
      `脚注 ${String(node.attrs.label || '')}`
    ];
  },
  markdownTokenName: 'linuxdoFootnoteReference',
  markdownTokenizer: {
    name: 'linuxdoFootnoteReference',
    level: 'inline',
    start: (source) => source.indexOf('[^'),
    tokenize(source) {
      const match = source.match(/^\[\^([^\]\n]+)\]/);
      return match ? { type: 'linuxdoFootnoteReference', raw: match[0], label: match[1] } : undefined;
    }
  },
  parseMarkdown(token, helpers) {
    return helpers.createNode('linuxdoFootnoteReference', { raw: token.raw, label: token.label });
  },
  renderMarkdown(node) {
    return String(node.attrs?.raw || '');
  }
});

const LinuxDoFootnoteDefinitionNode = TiptapNode.create({
  name: 'linuxdoFootnoteDefinition',
  group: 'block',
  atom: true,
  isolating: true,
  priority: 1_000,
  addAttributes() {
    return { raw: { default: '' }, label: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-composer-node="linuxdo-footnote-definition"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        class: 'tiptap-card private-card',
        'data-composer-node': 'linuxdo-footnote-definition',
        contenteditable: 'false'
      }),
      ['strong', {}, `脚注定义 ${String(node.attrs.label || '')}`],
      ['span', { class: 'card-body' }, String(node.attrs.raw || '')]
    ];
  },
  markdownTokenName: 'linuxdoFootnoteDefinition',
  markdownTokenizer: {
    name: 'linuxdoFootnoteDefinition',
    level: 'block',
    start: (source) => source.search(/^\[\^[^\]\n]+\]:/m),
    tokenize(source) {
      const first = source.match(/^\[\^([^\]\n]+)\]:[^\n]*(?:\n|$)/);
      if (!first) return undefined;
      let end = first[0].length;
      while (end < source.length) {
        const lineEnd = source.indexOf('\n', end);
        const line = source.slice(end, lineEnd < 0 ? source.length : lineEnd + 1);
        if (!/^\s{2,}\S/.test(line)) break;
        end += line.length;
      }
      const raw = source.slice(0, end).replace(/\n$/, '');
      return { type: 'linuxdoFootnoteDefinition', raw, label: first[1] };
    }
  },
  parseMarkdown(token, helpers) {
    return helpers.createNode('linuxdoFootnoteDefinition', { raw: token.raw, label: token.label });
  },
  renderMarkdown(node) {
    return String(node.attrs?.raw || '');
  }
});

function escapeGfmTableCell(value: string) {
  let output = '';
  let precedingBackslashes = 0;
  for (const character of value) {
    if (character === '|' && precedingBackslashes % 2 === 0) output += '\\';
    output += character;
    precedingBackslashes = character === '\\' ? precedingBackslashes + 1 : 0;
  }
  return output;
}

export function setGfmColumnAlignment(editor: TiptapEditor, alignment: 'left' | 'center' | 'right') {
  return editor
    .chain()
    .focus()
    .command(({ state, tr }) => {
      const rectangle = selectedRect(state);
      const positions = new Set<number>();
      for (let row = 0; row < rectangle.map.height; row += 1) {
        for (let column = rectangle.left; column < rectangle.right; column += 1) {
          positions.add(rectangle.tableStart + rectangle.map.positionAt(row, column, rectangle.table));
        }
      }
      positions.forEach((position) => {
        const cell = tr.doc.nodeAt(position);
        if (cell) tr.setNodeMarkup(position, undefined, { ...cell.attrs, align: alignment });
      });
      return true;
    })
    .run();
}

const StrictGfmTable = Table.extend({
  renderMarkdown(node, helpers) {
    return renderTableToMarkdown(node, {
      ...helpers,
      renderChildren: (children, separator) => escapeGfmTableCell(helpers.renderChildren(children, separator))
    });
  }
});

const StrictGfmTableHeaders = Extension.create({
  name: 'strictGfmTableHeaders',
  addProseMirrorPlugins() {
    const headerType = this.editor.schema.nodes.tableHeader;
    return [
      new Plugin({
        appendTransaction(transactions, _oldState, newState) {
          if (!headerType || !transactions.some((transaction) => transaction.docChanged)) return null;
          const transaction = newState.tr;
          newState.doc.descendants((node, position) => {
            if (node.type.name !== 'table') return;
            node.firstChild?.forEach((cell, offset) => {
              if (cell.type !== headerType) transaction.setNodeMarkup(position + 2 + offset, headerType, cell.attrs);
            });
            return false;
          });
          return transaction.steps.length ? transaction : null;
        }
      })
    ];
  }
});

export const composerEditorExtensions = [
  StarterKit.configure({
    link: { openOnClick: false, autolink: true },
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    hardBreak: { keepMarks: true }
  }),
  Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
  TableKit.configure({ table: false }),
  StrictGfmTable.configure({ resizable: false }),
  StrictGfmTableHeaders,
  TaskList,
  TaskItem.configure({ nested: true }),
  Image.configure({ allowBase64: false, resize: false }),
  ForumExpressionNode,
  PendingNodeSeekPollNode,
  NodeSeekRemotePollNode,
  NodeSeekStardustNode,
  ForumPrivateBlockNode,
  LinuxDoDateNode,
  LinuxDoFootnoteDefinitionNode,
  LinuxDoFootnoteReferenceNode
];

function currentAtom(editor: TiptapEditor | null, type: string) {
  const selection = editor?.state.selection as { node?: { type: { name: string }; attrs: Record<string, unknown> } };
  return selection?.node?.type.name === type ? selection.node : null;
}

function insertMarkdown(editor: TiptapEditor, markdown: string) {
  const selection = editor.state.selection;
  const target = selection instanceof NodeSelection && selection.node.isAtom ? selection.to : undefined;
  const chain = editor.chain().focus(undefined, { scrollIntoView: false });
  if (target === undefined) chain.insertContent(markdown, { contentType: 'markdown' }).run();
  else chain.insertContentAt(target, markdown, { contentType: 'markdown', updateSelection: true }).run();
  focusTextAfterBlock(editor);
}

function focusTextAfterBlock(editor: TiptapEditor) {
  if (editor.state.selection instanceof TextSelection) {
    editor.commands.focus(undefined, { scrollIntoView: false });
    return;
  }
  const next = Selection.findFrom(editor.state.doc.resolve(editor.state.selection.to), 1, true);
  if (next instanceof TextSelection) editor.view.dispatch(editor.state.tr.setSelection(next));
  else editor.commands.createParagraphNear();
  editor.commands.focus(undefined, { scrollIntoView: false });
}

function insertBlockContent(editor: TiptapEditor, type: string, attrs: Record<string, unknown>) {
  const selection = editor.state.selection;
  const selected = selection instanceof NodeSelection ? selection.node : null;
  const sameNode =
    selected?.type.name === type &&
    (type !== 'forumPrivateBlock' || String(selected.attrs.kind || '') === String(attrs.kind || ''));
  const chain = editor.chain().focus(undefined, { scrollIntoView: false });
  if (sameNode) chain.updateAttributes(type, attrs).run();
  else if (selected?.isAtom) chain.insertContentAt(selection.to, { type, attrs }, { updateSelection: true }).run();
  else chain.insertContent({ type, attrs }).run();
  focusTextAfterBlock(editor);
}

async function uploadImageAtSelection(editor: TiptapEditor) {
  let from = editor.state.selection.from;
  let to = editor.state.selection.to;
  const trackSelection = ({
    transaction
  }: {
    transaction: { mapping: { map: (position: number, assoc?: number) => number } };
  }) => {
    from = transaction.mapping.map(from, -1);
    to = transaction.mapping.map(to, 1);
  };
  editor.on('transaction', trackSelection);
  try {
    const result = await requestHostAction('upload-image');
    const markdown = typeof result === 'string' ? result : (result as { markdown?: string })?.markdown;
    if (markdown && !editor.isDestroyed) {
      editor.chain().focus().insertContentAt({ from, to }, markdown, { contentType: 'markdown' }).run();
    }
  } catch (error) {
    window.alert(error instanceof Error ? error.message : '图片上传失败');
  } finally {
    editor.off('transaction', trackSelection);
  }
}

function htmlHasMergedTableCells(html: string) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return [...parsed.querySelectorAll('td,th')].some((cell) => {
    const colSpan = Number(cell.getAttribute('colspan') || '1');
    const rowSpan = Number(cell.getAttribute('rowspan') || '1');
    return colSpan !== 1 || rowSpan !== 1;
  });
}

export function sanitizePastedHtml(html: string) {
  if (htmlHasMergedTableCells(html)) {
    window.alert('合并单元格无法无损发布为 GFM，已拒绝粘贴该表格。');
    return '';
  }
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p',
      'br',
      'strong',
      'b',
      'em',
      'i',
      's',
      'del',
      'u',
      'code',
      'pre',
      'blockquote',
      'a',
      'img',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'ol',
      'li',
      'hr',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td'
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'data-type', 'data-checked']
  });
}

const markdownCodeParser = markdownLanguage().language.parser;
const markdownCodeNodes = new Set(['InlineCode', 'FencedCode', 'CodeBlock']);

function maskMarkdownCode(markdown: string) {
  if (!/[`~\t]| {4}/.test(markdown)) return markdown;
  const ranges: { from: number; to: number }[] = [];
  markdownCodeParser.parse(markdown).iterate({
    enter(node) {
      if (!markdownCodeNodes.has(node.name)) return;
      ranges.push({ from: node.from, to: node.to });
      return false;
    }
  });
  if (!ranges.length) return markdown;
  let cursor = 0;
  let masked = '';
  ranges.forEach(({ from, to }) => {
    masked += markdown.slice(cursor, from);
    masked += ' '.repeat(to - from);
    cursor = to;
  });
  return masked + markdown.slice(cursor);
}

function validateMarkdown(
  markdown: string,
  config: RuntimeConfig | null,
  pollsById: Map<string, PendingNodeSeekPoll>,
  activeMarkdown: string
) {
  const issues: ComposerValidationIssue[] = [];
  const lowerMarkdown = asciiLowerCase(activeMarkdown);
  if (markdown.length > MAX_COMPOSER_MARKDOWN_LENGTH) {
    issues.push({ code: 'too-long', message: '正文超过允许长度' });
  }
  for (const [opening, closing, code] of [
    ['[poll', '[/poll]', 'linuxdo-poll'],
    ['[details', '[/details]', 'linuxdo-details'],
    ['[spoiler', '[/spoiler]', 'linuxdo-spoiler']
  ] as const) {
    let cursor = 0;
    while ((cursor = lowerMarkdown.indexOf(opening, cursor)) >= 0) {
      const closeAt = lowerMarkdown.indexOf(closing, cursor + opening.length);
      if (closeAt < 0) {
        issues.push({ code, message: `${opening} 缺少 ${closing}`, from: cursor, to: cursor + opening.length });
        break;
      }
      cursor = closeAt + closing.length;
    }
  }
  if (/<(?:td|th)\b[^>]*(?:rowspan|colspan)\s*=\s*["']?(?!1\b)/i.test(activeMarkdown)) {
    issues.push({ code: 'merged-table', message: '合并单元格无法无损发布为 GFM' });
  }
  for (const token of nodeSeekPendingPollTokenRanges(activeMarkdown)) {
    if (!pollsById.has(token.localId)) {
      issues.push({
        code: 'missing-poll-sidecar',
        message: '本地投票数据缺失，请移除后重新插入',
        from: token.from,
        to: token.to
      });
    }
  }
  if (config?.site === 'nodeseek') {
    nodeSeekStardustMarkerRanges(activeMarkdown).forEach((range) => {
      if (range.receive && !normalizeNodeSeekStardustRefId(range.receive.refId)) {
        issues.push({
          code: 'stardust-ref-invalid',
          message: 'Ref ID 必须为大于等于 100 的安全整数',
          from: range.from,
          to: range.to
        });
      }
      if (range.receive && config.nodeSeekMemberId && range.receive.receiverMemberId !== config.nodeSeekMemberId) {
        issues.push({
          code: 'stardust-receiver-mismatch',
          message: '收款卡片属于其他账号，请替换为当前账号或移除',
          from: range.from,
          to: range.to
        });
      }
    });
  }
  return issues;
}

function readPollsFromEditor(editor: TiptapEditor | null) {
  const result: PendingNodeSeekPoll[] = [];
  editor?.state.doc.descendants((node) => {
    if (node.type.name !== 'pendingNodeSeekPoll') return;
    try {
      const poll = normalizePendingNodeSeekPoll({
        localId: String(node.attrs.localId),
        title: String(node.attrs.title),
        multiple: Boolean(node.attrs.multiple),
        isPublic: Boolean(node.attrs.isPublic),
        options: JSON.parse(String(node.attrs.options || '[]')),
        fingerprint: String(node.attrs.fingerprint || ''),
        ...(node.attrs.remoteId ? { remoteId: String(node.attrs.remoteId) } : {})
      });
      pendingPolls.set(poll.localId, poll);
      result.push(poll);
    } catch {
      // The snapshot validation below reports the missing sidecar/node.
    }
  });
  return result;
}

function pollsForSource(markdown: string) {
  return nodeSeekPendingPollTokenRanges(markdown)
    .map((token) => pendingPolls.get(token.localId))
    .filter((poll): poll is PendingNodeSeekPoll => Boolean(poll));
}

// Lucide v1.16 icon nodes (ISC; see ./lucide.LICENSE). The native package is already a
// project dependency; the local editor renders the same icon language without bundling it twice.
const EDITOR_ICON_NODES = {
  smile: [
    ['path', { d: 'M22 11v1a10 10 0 1 1-9-10', key: 'face' }],
    ['path', { d: 'M8 14s1.5 2 4 2 4-2 4-2', key: 'smile' }],
    ['line', { x1: '9', x2: '9.01', y1: '9', y2: '9', key: 'eye-left' }],
    ['line', { x1: '15', x2: '15.01', y1: '9', y2: '9', key: 'eye-right' }],
    ['path', { d: 'M16 5h6', key: 'plus-horizontal' }],
    ['path', { d: 'M19 2v6', key: 'plus-vertical' }]
  ],
  image: [
    ['path', { d: 'M16 5h6', key: 'plus-horizontal' }],
    ['path', { d: 'M19 2v6', key: 'plus-vertical' }],
    ['path', { d: 'M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5', key: 'frame' }],
    ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21', key: 'landscape' }],
    ['circle', { cx: '9', cy: '9', r: '2', key: 'sun' }]
  ],
  bold: [['path', { d: 'M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8', key: 'bold' }]],
  italic: [
    ['line', { x1: '19', x2: '10', y1: '4', y2: '4', key: 'top' }],
    ['line', { x1: '14', x2: '5', y1: '20', y2: '20', key: 'bottom' }],
    ['line', { x1: '15', x2: '9', y1: '4', y2: '20', key: 'stem' }]
  ],
  strike: [
    ['path', { d: 'M16 4H9a3 3 0 0 0-2.83 4', key: 'top' }],
    ['path', { d: 'M14 12a4 4 0 0 1 0 8H6', key: 'bottom' }],
    ['path', { d: 'M4 12h16', key: 'line' }]
  ],
  underline: [
    ['path', { d: 'M6 4v6a6 6 0 0 0 12 0V4', key: 'stem' }],
    ['line', { x1: '4', x2: '20', y1: '22', y2: '22', key: 'line' }]
  ],
  link: [
    ['path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', key: 'right' }],
    ['path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71', key: 'left' }]
  ],
  quote: [
    [
      'path',
      {
        d: 'M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z',
        key: 'right'
      }
    ],
    [
      'path',
      {
        d: 'M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z',
        key: 'left'
      }
    ]
  ],
  code: [
    ['path', { d: 'm18 16 4-4-4-4', key: 'right' }],
    ['path', { d: 'm6 8-4 4 4 4', key: 'left' }],
    ['path', { d: 'm14.5 4-5 16', key: 'slash' }]
  ],
  list: [
    ['path', { d: 'M3 5h.01', key: 'dot-1' }],
    ['path', { d: 'M3 12h.01', key: 'dot-2' }],
    ['path', { d: 'M3 19h.01', key: 'dot-3' }],
    ['path', { d: 'M8 5h13', key: 'line-1' }],
    ['path', { d: 'M8 12h13', key: 'line-2' }],
    ['path', { d: 'M8 19h13', key: 'line-3' }]
  ],
  codeBlock: [
    ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2', key: 'frame' }],
    ['path', { d: 'm9 9-3 3 3 3', key: 'left' }],
    ['path', { d: 'm15 9 3 3-3 3', key: 'right' }]
  ],
  divider: [['path', { d: 'M4 12h16', key: 'line' }]],
  table: [
    [
      'path',
      {
        d: 'M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18',
        key: 'table'
      }
    ]
  ],
  poll: [
    ['path', { d: 'M4 20V10', key: 'bar-1' }],
    ['path', { d: 'M10 20V4', key: 'bar-2' }],
    ['path', { d: 'M16 20v-7', key: 'bar-3' }],
    ['path', { d: 'M22 20H2', key: 'base' }]
  ],
  wallet: [
    ['path', { d: 'M20 7V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v10a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6', key: 'body' }],
    ['path', { d: 'M16 13h.01', key: 'dot' }]
  ],
  tools: [
    ['path', { d: 'M14.7 6.3a4 4 0 0 0-5-5L7 4l3 3 2.7-.7Z', key: 'head' }],
    ['path', { d: 'm8 8-6 6 4 4 6-6', key: 'handle' }],
    ['path', { d: 'm14 14 6 6', key: 'tail' }]
  ],
  template: [
    ['path', { d: 'M6 2h9l5 5v15H6z', key: 'page' }],
    ['path', { d: 'M14 2v6h6', key: 'fold' }],
    ['path', { d: 'M9 13h8', key: 'line-1' }],
    ['path', { d: 'M9 17h6', key: 'line-2' }]
  ],
  trash: [
    ['path', { d: 'M10 11v6', key: 'left' }],
    ['path', { d: 'M14 11v6', key: 'right' }],
    ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', key: 'body' }],
    ['path', { d: 'M3 6h18', key: 'top' }],
    ['path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', key: 'handle' }]
  ],
  plus: [
    ['path', { d: 'M5 12h14', key: 'horizontal' }],
    ['path', { d: 'M12 5v14', key: 'vertical' }]
  ],
  search: [
    ['circle', { cx: '11', cy: '11', r: '8', key: 'lens' }],
    ['path', { d: 'm21 21-4.3-4.3', key: 'handle' }]
  ],
  chevronDown: [['path', { d: 'm6 9 6 6 6-6', key: 'chevron' }]],
  close: [
    ['path', { d: 'M18 6 6 18', key: 'down' }],
    ['path', { d: 'm6 6 12 12', key: 'up' }]
  ]
} as const;

type EditorIconName = keyof typeof EDITOR_ICON_NODES;

function EditorIcon({ name }: { name: EditorIconName }) {
  const nodes = EDITOR_ICON_NODES[name] as readonly (readonly [string, Record<string, string>])[];
  return (
    <svg aria-hidden="true" className="tool-icon" fill="none" viewBox="0 0 24 24">
      {nodes.map(([element, attributes]) => React.createElement(element, attributes))}
    </svg>
  );
}

function applyTheme(theme: RuntimeTheme) {
  const root = document.documentElement;
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
  root.style.setProperty('--ink', theme.ink);
  root.style.setProperty('--muted', theme.muted);
  root.style.setProperty('--surface', theme.surface);
  root.style.setProperty('--surface-2', theme.surface2);
  root.style.setProperty('--line', theme.line);
  root.style.setProperty('--primary', theme.primary);
  root.style.setProperty('--primary-soft', theme.primarySoft);
  root.style.setProperty('--danger', theme.danger);
  root.style.setProperty('--font-scale', String(theme.fontScale));
}

type TableAlignment = 'left' | 'center' | 'right';
type ToolbarState = {
  blockquote: boolean;
  bold: boolean;
  bulletList: boolean;
  code: boolean;
  codeBlock: boolean;
  heading: number;
  italic: boolean;
  orderedList: boolean;
  strike: boolean;
  table: boolean;
  taskList: boolean;
  underline: boolean;
};

function ComposerToolbarState({
  children,
  editor
}: {
  children: (state: ToolbarState) => React.ReactNode;
  editor: TiptapEditor;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: currentEditor }): ToolbarState => ({
      blockquote: Boolean(currentEditor?.isActive('blockquote')),
      bold: Boolean(currentEditor?.isActive('bold')),
      bulletList: Boolean(currentEditor?.isActive('bulletList')),
      code: Boolean(currentEditor?.isActive('code')),
      codeBlock: Boolean(currentEditor?.isActive('codeBlock')),
      heading: currentEditor?.isActive('heading') ? Number(currentEditor.getAttributes('heading').level || 2) : 0,
      italic: Boolean(currentEditor?.isActive('italic')),
      orderedList: Boolean(currentEditor?.isActive('orderedList')),
      strike: Boolean(currentEditor?.isActive('strike')),
      table: Boolean(currentEditor?.isActive('table')),
      taskList: Boolean(currentEditor?.isActive('taskList')),
      underline: Boolean(currentEditor?.isActive('underline'))
    })
  });
  return state ? children(state) : null;
}

export function tableMenuViewportPadding() {
  const toolbarBottom = document.querySelector<HTMLElement>('.toolbar-stack')?.getBoundingClientRect().bottom || 0;
  return { top: Math.ceil(toolbarBottom) + 8, right: 8, bottom: 8, left: 8 };
}

/*
 * Whole-table anchoring follows mui-tiptap's MIT TableBubbleMenu pattern at
 * https://github.com/sjdemartini/mui-tiptap/blob/d8258685e23fdb150a61168553c52ef15420fd74/src/TableBubbleMenu.tsx
 * See ./mui-tiptap.LICENSE.
 */
function TableContextMenu({ editor }: { editor: TiptapEditor }) {
  const tableState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      alignment: (currentEditor?.getAttributes('tableCell').align ||
        currentEditor?.getAttributes('tableHeader').align ||
        'left') as TableAlignment,
      canAddColumnAfter: Boolean(currentEditor?.can().addColumnAfter()),
      canAddColumnBefore: Boolean(currentEditor?.can().addColumnBefore()),
      canAddRowAfter: Boolean(currentEditor?.can().addRowAfter()),
      canAddRowBefore: Boolean(currentEditor?.can().addRowBefore()),
      canDeleteColumn: Boolean(currentEditor?.can().deleteColumn()),
      canDeleteRow: Boolean(currentEditor?.can().deleteRow()),
      canDeleteTable: Boolean(currentEditor?.can().deleteTable())
    })
  });
  const focusEditor = () => {
    if (!editor.isFocused) editor.commands.focus();
  };
  const getTableReference = useCallback(() => {
    const parent = findParentNodeClosestToPos(editor.state.selection.$anchor, (node) => node.type.name === 'table');
    if (!parent) return null;
    const node = editor.view.nodeDOM(parent.pos);
    if (!(node instanceof HTMLElement)) return null;
    const table = node.matches('table') ? node : node.querySelector('table');
    if (!table) return null;
    return {
      contextElement: table,
      getBoundingClientRect: () => table.getBoundingClientRect(),
      getClientRects: () => [table.getBoundingClientRect()]
    };
  }, [editor]);

  return (
    <BubbleMenu
      appendTo={() => document.body}
      aria-label="表格操作"
      className="tiptap-card table-context-toolbar"
      editor={editor}
      getReferencedVirtualElement={getTableReference}
      options={{
        strategy: 'fixed',
        placement: 'top-start',
        offset: 6,
        flip: () => ({ fallbackPlacements: ['bottom-start'], padding: tableMenuViewportPadding() }),
        shift: () => ({ padding: tableMenuViewportPadding() })
      }}
      pluginKey="composerTableMenu"
      resizeDelay={60}
      role="toolbar"
      shouldShow={({ editor: currentEditor }) => currentEditor.isEditable && currentEditor.isActive('table')}
      updateDelay={250}
    >
      <EditorDropdown
        label="行操作"
        onCloseAutoFocus={focusEditor}
        portal={false}
        trigger={
          <EditorButton aria-label="行操作" aria-haspopup="menu" className="table-menu-trigger" type="button">
            行
            <EditorIcon name="chevronDown" />
          </EditorButton>
        }
      >
        <EditorDropdownItem
          disabled={!tableState?.canAddRowBefore}
          label="在上方插入"
          onSelect={() => editor.chain().focus().addRowBefore().run()}
        >
          在上方插入
        </EditorDropdownItem>
        <EditorDropdownItem
          disabled={!tableState?.canAddRowAfter}
          label="在下方插入"
          onSelect={() => editor.chain().focus().addRowAfter().run()}
        >
          在下方插入
        </EditorDropdownItem>
        <EditorDropdownItem
          danger
          disabled={!tableState?.canDeleteRow}
          label="删除当前行"
          onSelect={() => editor.chain().focus().deleteRow().run()}
        >
          删除当前行
        </EditorDropdownItem>
      </EditorDropdown>
      <EditorSeparator decorative />
      <EditorDropdown
        label="列操作"
        onCloseAutoFocus={focusEditor}
        portal={false}
        trigger={
          <EditorButton aria-label="列操作" aria-haspopup="menu" className="table-menu-trigger" type="button">
            列
            <EditorIcon name="chevronDown" />
          </EditorButton>
        }
      >
        <EditorDropdownItem
          disabled={!tableState?.canAddColumnBefore}
          label="在左侧插入"
          onSelect={() => editor.chain().focus().addColumnBefore().run()}
        >
          在左侧插入
        </EditorDropdownItem>
        <EditorDropdownItem
          disabled={!tableState?.canAddColumnAfter}
          label="在右侧插入"
          onSelect={() => editor.chain().focus().addColumnAfter().run()}
        >
          在右侧插入
        </EditorDropdownItem>
        <EditorDropdownItem
          danger
          disabled={!tableState?.canDeleteColumn}
          label="删除当前列"
          onSelect={() => editor.chain().focus().deleteColumn().run()}
        >
          删除当前列
        </EditorDropdownItem>
      </EditorDropdown>
      <EditorSeparator decorative />
      <EditorDropdown
        label="列对齐"
        onCloseAutoFocus={focusEditor}
        portal={false}
        trigger={
          <EditorButton aria-label="列对齐" aria-haspopup="menu" className="table-menu-trigger" type="button">
            对齐
            <EditorIcon name="chevronDown" />
          </EditorButton>
        }
      >
        <EditorDropdownRadioGroup>
          {(
            [
              ['left', '左对齐'],
              ['center', '居中'],
              ['right', '右对齐']
            ] as const
          ).map(([value, label]) => (
            <EditorDropdownRadioItem
              checked={tableState?.alignment === value}
              key={value}
              label={label}
              onSelect={() => setGfmColumnAlignment(editor, value)}
            >
              {label}
            </EditorDropdownRadioItem>
          ))}
        </EditorDropdownRadioGroup>
      </EditorDropdown>
      <EditorSeparator decorative />
      <EditorButton
        aria-label="删除整个表格"
        className="table-delete"
        danger
        disabled={!tableState?.canDeleteTable}
        type="button"
        onClick={() => editor.chain().focus().deleteTable().run()}
      >
        <EditorIcon name="trash" />
        删除表格
      </EditorButton>
    </BubbleMenu>
  );
}

function ExpressionButton({
  label,
  src,
  visible,
  onInsert,
  children
}: {
  label: string;
  src: string;
  visible: boolean;
  onInsert: () => void;
  children?: React.ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const current = useRef({ attempt: 0, failed: false });
  const retry = useCallback(() => {
    current.current = { attempt: current.current.attempt + 1, failed: false };
    setAttempt(current.current.attempt);
    setStatus('loading');
  }, []);
  useEffect(() => {
    if (visible && current.current.failed) retry();
  }, [retry, visible]);
  const settle = (next: 'loaded' | 'failed') => {
    if (current.current.attempt !== attempt) return;
    current.current.failed = next === 'failed';
    setStatus(next);
  };
  return (
    <EditorButton
      aria-label={status === 'failed' ? `${label}，加载失败，点击重试` : label}
      aria-busy={attempt > 0 && status === 'loading'}
      type="button"
      onClick={() => {
        if (status === 'failed') retry();
        else if (attempt === 0 || status === 'loaded') onInsert();
      }}
    >
      <img
        key={attempt}
        alt=""
        decoding="async"
        loading="lazy"
        src={src}
        onLoad={() => settle('loaded')}
        onError={() => settle('failed')}
      />
      {status === 'failed' ? <span>重试</span> : children}
    </EditorButton>
  );
}

function BuilderPanel({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="builder-backdrop" role="presentation" onMouseDown={onClose}>
      <EditorCard
        aria-label={title}
        aria-modal="true"
        className="builder-panel"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <EditorCardHeader className="builder-header">
          <strong>{title}</strong>
          <EditorButton aria-label="关闭" iconOnly type="button" onClick={onClose}>
            <EditorIcon name="close" />
          </EditorButton>
        </EditorCardHeader>
        <EditorCardBody className="builder-body">{children}</EditorCardBody>
      </EditorCard>
    </div>
  );
}

function PollOptionFields({ options, onChange }: { options: string[]; onChange: (options: string[]) => void }) {
  return (
    <fieldset className="poll-options">
      <legend>选项</legend>
      <div className="poll-option-list">
        {options.map((option, index) => (
          <div className="poll-option-row" key={index}>
            <span aria-hidden="true" className="poll-option-number">
              {index + 1}
            </span>
            <EditorInput
              aria-label={`投票选项 ${index + 1}`}
              autoComplete="off"
              placeholder={`选项 ${index + 1}`}
              value={option}
              onChange={(event) =>
                onChange(options.map((value, optionIndex) => (optionIndex === index ? event.target.value : value)))
              }
            />
            <EditorButton
              aria-label={`删除投票选项 ${index + 1}`}
              disabled={options.length <= 1}
              iconOnly
              type="button"
              onClick={() => onChange(options.filter((_, optionIndex) => optionIndex !== index))}
            >
              <EditorIcon name="trash" />
            </EditorButton>
          </div>
        ))}
      </div>
      <EditorButton
        aria-label="添加投票选项"
        className="poll-option-add"
        type="button"
        onClick={() => onChange([...options, ''])}
      >
        <EditorIcon name="plus" />
        添加选项
      </EditorButton>
    </fieldset>
  );
}

function LinuxDoGroupChooser({
  capabilities,
  error,
  loading,
  onChange,
  onRetry,
  selected
}: {
  capabilities: LinuxDoPollCapabilities | null;
  error: string;
  loading: boolean;
  onChange: (groups: string[]) => void;
  onRetry: () => void;
  selected: string[];
}) {
  const [query, setQuery] = useState('');
  const available = capabilities?.groups || [];
  const availableByName = new Map(available.map((group) => [group.name, group]));
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = available.filter((group) =>
    `${group.displayName}\n${group.name}`.toLowerCase().includes(normalizedQuery)
  );
  const displayNameFor = (name: string) => availableByName.get(name)?.displayName || name;
  const triggerLabel = selected.length
    ? selected.length === 1
      ? displayNameFor(selected[0]!)
      : `已选 ${selected.length} 个用户组`
    : '选择用户组';
  return (
    <div className="tiptap-field group-chooser-field">
      <span>允许用户组</span>
      <EditorDropdown
        label="允许用户组"
        trigger={
          <EditorButton
            aria-label="允许用户组"
            aria-haspopup="menu"
            className="group-chooser-trigger"
            disabled={loading || !capabilities}
            type="button"
          >
            <span>{loading ? '正在加载用户组…' : triggerLabel}</span>
            <EditorIcon name="chevronDown" />
          </EditorButton>
        }
      >
        <div className="group-chooser-menu">
          <div className="expression-search">
            <EditorIcon name="search" />
            <EditorInput
              aria-label="搜索允许用户组"
              autoComplete="off"
              placeholder="搜索用户组"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="group-option-list">
            {filtered.map((group) => {
              const checked = selected.includes(group.name);
              return (
                <EditorDropdownCheckboxItem
                  checked={checked}
                  key={group.id}
                  label={`${checked ? '取消选择' : '选择'}用户组 ${group.displayName}`}
                  onSelect={() =>
                    onChange(checked ? selected.filter((name) => name !== group.name) : [...selected, group.name])
                  }
                >
                  {group.displayName}
                </EditorDropdownCheckboxItem>
              );
            })}
            {!filtered.length ? <p className="hint">没有匹配的用户组</p> : null}
          </div>
        </div>
      </EditorDropdown>
      {selected.length ? (
        <div aria-label="已选用户组" className="group-chip-list">
          {selected.map((name) => (
            <EditorButton
              aria-label={`移除用户组 ${displayNameFor(name)}`}
              className={`group-chip${availableByName.has(name) ? '' : ' unavailable'}`}
              key={name}
              type="button"
              onClick={() => onChange(selected.filter((group) => group !== name))}
            >
              <span>{displayNameFor(name)}</span>
              {!availableByName.has(name) ? <small>不可用，已保留</small> : null}
              <EditorIcon name="close" />
            </EditorButton>
          ))}
        </div>
      ) : null}
      {error ? (
        <div className="inline-retry" role="alert">
          <span>{error}</span>
          <EditorButton type="button" onClick={onRetry}>
            重试
          </EditorButton>
        </div>
      ) : null}
    </div>
  );
}

function linuxDoPollCloseParts(close: string) {
  const date = new Date(close);
  if (!close || Number.isNaN(date.getTime())) return { date: '', time: '' };
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

function linuxDoPollCloseIso(date: string, time: string) {
  if (!date) return '';
  const value = new Date(`${date}T${time || '12:00'}:00`);
  return Number.isNaN(value.getTime()) ? '' : value.toISOString();
}

export function ComposerEditorRuntime() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const configRef = useRef<RuntimeConfig | null>(null);
  const maskedMarkdownRef = useRef<{ markdown: string; masked: string } | null>(null);
  const [mode, setMode] = useState<ComposerMode>('rich');
  const modeRef = useRef<ComposerMode>('rich');
  const revisionRef = useRef(0);
  const initializedRef = useRef(false);
  const suppressChangesRef = useRef(false);
  const sourceProgrammaticRef = useRef(false);
  const sourceHostRef = useRef<HTMLDivElement | null>(null);
  const sourceViewRef = useRef<EditorView | null>(null);
  const sourceUploadRangeRef = useRef<{ from: number; to: number } | null>(null);
  const imageBusyRef = useRef(false);
  const autosaveTimerRef = useRef<number | null>(null);
  const stateTimerRef = useRef<number | null>(null);
  const scheduleSignalsRef = useRef<() => void>(() => undefined);
  const [builder, setBuilder] = useState<ComposerBuilder>(null);
  const [builderError, setBuilderError] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const [pollTitle, setPollTitle] = useState('');
  const [pollOptions, setPollOptions] = useState(['选项一', '选项二']);
  const [pollMultiple, setPollMultiple] = useState(false);
  const [pollPublic, setPollPublic] = useState(false);
  const [linuxPoll, setLinuxPoll] = useState<LinuxDoPollDraft>(emptyLinuxDoPoll);
  const [linuxPollAdvanced, setLinuxPollAdvanced] = useState(false);
  const [linuxPollCapabilities, setLinuxPollCapabilities] = useState<LinuxDoPollCapabilities | null>(null);
  const [linuxPollCapabilitiesBusy, setLinuxPollCapabilitiesBusy] = useState(false);
  const [linuxPollCapabilitiesError, setLinuxPollCapabilitiesError] = useState('');
  const linuxPollCapabilitiesRequestRef = useRef<Promise<unknown> | null>(null);
  const [stardustAmount, setStardustAmount] = useState('1');
  const [stardustRefId, setStardustRefId] = useState('');
  const [stardustDescription, setStardustDescription] = useState('Pay with Stardust');
  const [stardustOneTime, setStardustOneTime] = useState(false);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [stickerCategory, setStickerCategory] = useState(NODESEEK_STICKER_CATEGORIES[0]!.label);
  const [emojiQuery, setEmojiQuery] = useState('');
  const [emojiLimit, setEmojiLimit] = useState(120);
  const filteredEmoji = useMemo(() => {
    const query = emojiQuery.trim().toLowerCase();
    const catalog: { name: string; url: string }[] = config?.discourseEmoji || [];
    return catalog.filter((item) => !query || item.name.toLowerCase().includes(query));
  }, [config?.discourseEmoji, emojiQuery]);
  const visibleEmoji = filteredEmoji.slice(0, emojiLimit);
  const loadMoreEmoji = () => setEmojiLimit((limit) => Math.min(limit + 120, filteredEmoji.length));

  const editor = useEditor({
    extensions: composerEditorExtensions,
    content: '',
    contentType: 'markdown',
    injectNonce: 'wz-composer-runtime',
    editorProps: {
      transformPastedHTML: sanitizePastedHtml,
      handlePaste: (_view, event) => {
        const html = event.clipboardData?.getData('text/html') || '';
        if (!html || !htmlHasMergedTableCells(html)) return false;
        event.preventDefault();
        window.alert('合并单元格无法无损发布为 GFM，已拒绝粘贴该表格。');
        return true;
      },
      handleClickOn: (_view, _pos, _node, _nodePos, event) => {
        if ((event.target as HTMLElement | null)?.closest('a')) {
          event.preventDefault();
          return true;
        }
        return false;
      },
      attributes: {
        class: 'ProseMirror composer-document',
        'aria-label': '回复正文富文本编辑器',
        'data-placeholder': '输入回复内容…',
        spellcheck: 'true'
      }
    },
    onCreate: ({ editor: currentEditor }) => syncEditorEmptyState(currentEditor),
    onUpdate: ({ editor: currentEditor }) => {
      syncEditorEmptyState(currentEditor);
      if (suppressChangesRef.current) return;
      revisionRef.current += 1;
      scheduleSignalsRef.current();
    }
  });
  const editorRef = useCommittedRef(editor);

  const validate = useCallback((markdown: string) => {
    if (maskedMarkdownRef.current?.markdown !== markdown) {
      maskedMarkdownRef.current = { markdown, masked: maskMarkdownCode(markdown) };
    }
    return validateMarkdown(markdown, configRef.current, pendingPolls, maskedMarkdownRef.current.masked);
  }, []);

  const makeSnapshot = useCallback(
    (forcedMode?: ComposerMode): ComposerSnapshot => {
      const snapshotMode = forcedMode || modeRef.current;
      const markdown =
        snapshotMode === 'source'
          ? sourceViewRef.current?.state.doc.toString() || ''
          : editorRef.current?.getMarkdown() || '';
      const polls = snapshotMode === 'source' ? pollsForSource(markdown) : readPollsFromEditor(editorRef.current);
      const issues = validate(markdown);
      return {
        revision: revisionRef.current,
        markdown,
        mode: snapshotMode,
        isEmpty: !markdown.replace(/<!-- wz:nodeseek-poll:[^>]+ -->/g, '').trim(),
        validationIssues: issues,
        pendingNodeSeekPolls: polls
      };
    },
    [editorRef, validate]
  );

  const postSnapshot = useCallback(
    (requestId?: string, forcedMode?: ComposerMode) => {
      postMessage('SNAPSHOT', { ...(requestId ? { requestId } : {}), snapshot: makeSnapshot(forcedMode) });
    },
    [makeSnapshot]
  );

  const postState = useCallback(() => {
    const currentEditor = editorRef.current;
    const currentMode = modeRef.current;
    postMessage('STATE_CHANGED', {
      revision: revisionRef.current,
      mode: currentMode,
      isEmpty:
        currentMode === 'rich' ? Boolean(currentEditor?.isEmpty) : (sourceViewRef.current?.state.doc.length ?? 0) === 0,
      canUndo: currentMode === 'rich' ? Boolean(currentEditor?.can().undo()) : true,
      canRedo: currentMode === 'rich' ? Boolean(currentEditor?.can().redo()) : true
    });
  }, [editorRef]);

  const scheduleSignals = useCallback(() => {
    if (stateTimerRef.current !== null) window.clearTimeout(stateTimerRef.current);
    stateTimerRef.current = window.setTimeout(postState, 100);
    if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => postSnapshot(), 600);
  }, [postSnapshot, postState]);
  useCommitRefValue(scheduleSignalsRef, scheduleSignals);

  const setSource = useCallback((value: string) => {
    const view = sourceViewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    sourceProgrammaticRef.current = true;
    replaceCodeMirrorDocument(view, value);
    sourceProgrammaticRef.current = false;
  }, []);

  const changeMode = useCallback(
    (nextMode: ComposerMode) => {
      if (nextMode === modeRef.current) {
        postSnapshot(undefined, nextMode);
        return;
      }
      if (imageBusyRef.current) {
        runtimeError('image-upload-pending', '图片上传完成后再切换编辑模式', revisionRef.current);
        postSnapshot(undefined, modeRef.current);
        return;
      }
      if (nextMode === 'source') {
        const markdown = editorRef.current?.getMarkdown() || '';
        readPollsFromEditor(editorRef.current);
        setSource(markdown);
        modeRef.current = 'source';
        setMode('source');
        window.requestAnimationFrame(() => sourceViewRef.current?.focus());
        postSnapshot(undefined, 'source');
        postState();
        return;
      }
      const markdown = sourceViewRef.current?.state.doc.toString() || '';
      const issues = validate(markdown);
      if (issues.length) {
        const issue = issues[0]!;
        const view = sourceViewRef.current;
        if (view && issue.from !== undefined) {
          const anchor = Math.max(0, Math.min(issue.from, view.state.doc.length));
          const head = Math.max(anchor, Math.min(issue.to ?? anchor, view.state.doc.length));
          view.dispatch({ selection: { anchor, head }, scrollIntoView: true });
          view.focus();
        }
        runtimeError('markdown-invalid', issue.message, revisionRef.current);
        postSnapshot(undefined, 'source');
        return;
      }
      try {
        suppressChangesRef.current = true;
        setExpressionConfig(editorRef.current, configRef.current);
        if (editorRef.current?.getMarkdown() !== markdown) replaceRichMarkdownDocument(editorRef.current, markdown);
        suppressChangesRef.current = false;
        modeRef.current = 'rich';
        setMode('rich');
        window.requestAnimationFrame(() => editorRef.current?.commands.focus());
        postSnapshot(undefined, 'rich');
        postState();
      } catch {
        suppressChangesRef.current = false;
        runtimeError('markdown-parse-failed', 'Markdown 无法解析，已保留源码', revisionRef.current);
      }
    },
    [editorRef, postSnapshot, postState, setSource, validate]
  );

  const applyInit = useCallback(
    (next: RuntimeConfig) => {
      maskedMarkdownRef.current = null;
      configRef.current = next;
      setConfig(next);
      setBuilder(null);
      setBuilderError('');
      setEmojiLimit(120);
      setLinuxPollCapabilities(null);
      setLinuxPollCapabilitiesBusy(false);
      setLinuxPollCapabilitiesError('');
      linuxPollCapabilitiesRequestRef.current = null;
      applyTheme(next.theme);
      pendingPolls.clear();
      next.pendingNodeSeekPolls.forEach((poll) => pendingPolls.set(poll.localId, poll));
      suppressChangesRef.current = true;
      setExpressionConfig(editorRef.current, next);
      replaceRichMarkdownDocument(editorRef.current, next.markdown);
      setSource(next.markdown);
      suppressChangesRef.current = false;
      revisionRef.current = 0;
      modeRef.current = next.mode;
      setMode(next.mode);
      initializedRef.current = true;
      postMessage('READY', { revision: 0 });
      postState();
    },
    [editorRef, postState, setSource]
  );

  const handleHostMessage = useCallback(
    (message: ComposerHostMessage) => {
      if (message.type === 'INIT') {
        applyInit(message.payload);
        return;
      }
      if (!initializedRef.current) return;
      if (message.type === 'SET_THEME') {
        applyTheme(message.payload);
        return;
      }
      if (message.type === 'SET_MODE') {
        changeMode(message.payload.mode);
        return;
      }
      if (message.type === 'REQUEST_SNAPSHOT') {
        postSnapshot(message.payload.requestId);
        return;
      }
      if (message.type === 'DESTROY') {
        maskedMarkdownRef.current = null;
        editorRef.current?.destroy();
        sourceViewRef.current?.destroy();
        sourceViewRef.current = null;
        hostActionResolvers.forEach((resolver) => resolver.reject(new Error('编辑器已关闭')));
        hostActionResolvers.clear();
        return;
      }
      const command = message.payload;
      if (command.name === 'set-discourse-emoji') {
        const currentConfig = configRef.current;
        if (!currentConfig || currentConfig.site !== 'linuxdo') return;
        const nextConfig = { ...currentConfig, discourseEmoji: command.discourseEmoji };
        configRef.current = nextConfig;
        setConfig(nextConfig);
        setExpressionConfig(editorRef.current, nextConfig);
      } else if (command.name === 'insert-markdown') {
        if (modeRef.current === 'rich' && editorRef.current) insertMarkdown(editorRef.current, command.markdown);
        else {
          const view = sourceViewRef.current;
          if (view) view.dispatch(view.state.replaceSelection(command.markdown));
        }
      } else if (command.name === 'focus') {
        if (modeRef.current === 'rich') editorRef.current?.commands.focus();
        else sourceViewRef.current?.focus();
      } else if (command.name === 'blur') {
        editorRef.current?.commands.blur();
        sourceViewRef.current?.contentDOM.blur();
      } else if (command.name === 'undo') {
        if (modeRef.current === 'rich') editorRef.current?.commands.undo();
        else if (sourceViewRef.current) undo(sourceViewRef.current);
      } else if (command.name === 'redo') {
        if (modeRef.current === 'rich') editorRef.current?.commands.redo();
        else if (sourceViewRef.current) redo(sourceViewRef.current);
      } else if (command.name === 'host-action-result') {
        const resolver = hostActionResolvers.get(command.requestId);
        hostActionResolvers.delete(command.requestId);
        if (command.error) resolver?.reject(new Error(command.error));
        else resolver?.resolve(command.result);
      }
    },
    [applyInit, changeMode, editorRef, postSnapshot]
  );

  useEffect(() => {
    const receive = (event: Event) => {
      const raw = (event as MessageEvent).data;
      if (typeof raw !== 'string') return;
      try {
        const parsed = composerHostMessageSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) {
          runtimeError('bridge-invalid', '编辑器收到无效消息', revisionRef.current);
          return;
        }
        handleHostMessage(parsed.data);
      } catch {
        runtimeError('bridge-invalid-json', '编辑器收到无效消息', revisionRef.current);
      }
    };
    window.addEventListener('message', receive);
    document.addEventListener('message', receive);
    return () => {
      window.removeEventListener('message', receive);
      document.removeEventListener('message', receive);
    };
  }, [handleHostMessage]);

  useEffect(() => {
    const host = sourceHostRef.current;
    if (!host || sourceViewRef.current) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: '',
        extensions: [
          markdownLanguage(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.lineWrapping,
          EditorView.cspNonce.of('wz-composer-runtime'),
          EditorState.changeFilter.of((transaction) => {
            if (sourceProgrammaticRef.current || !transaction.docChanged) return true;
            const source = transaction.startState.doc.toString();
            const ranges = [...nodeSeekPendingPollTokenRanges(source), ...nodeSeekRemotePollMarkerRanges(source)];
            let allowed = true;
            transaction.changes.iterChangedRanges((fromA, toA) => {
              ranges.forEach((range) => {
                const intersects = fromA < range.to && toA > range.from;
                const removesWholeToken = fromA <= range.from && toA >= range.to;
                if (intersects && !removesWholeToken) allowed = false;
              });
            });
            return allowed;
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || sourceProgrammaticRef.current) return;
            const uploadRange = sourceUploadRangeRef.current;
            if (uploadRange) {
              const { from, to } = uploadRange;
              const empty = from === to;
              uploadRange.from = update.changes.mapPos(from, empty ? 1 : -1);
              uploadRange.to = update.changes.mapPos(to, 1);
            }
            revisionRef.current += 1;
            scheduleSignalsRef.current();
          })
        ]
      })
    });
    sourceViewRef.current = view;
    return () => {
      view.destroy();
      if (sourceViewRef.current === view) sourceViewRef.current = null;
    };
  }, []);

  useEffect(
    () => () => {
      if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
      if (stateTimerRef.current !== null) window.clearTimeout(stateTimerRef.current);
    },
    []
  );

  const showBuilder = (next: Exclude<ComposerBuilder, null>) => {
    setBuilderError('');
    editorRef.current?.commands.blur();
    sourceViewRef.current?.contentDOM.blur();
    setBuilder(next);
  };

  const insertAtSelection = (markdown: string) => {
    if (modeRef.current === 'rich' && editorRef.current) {
      insertMarkdown(editorRef.current, markdown);
      return;
    }
    const view = sourceViewRef.current;
    if (view) {
      view.dispatch(view.state.replaceSelection(markdown));
      view.focus();
    }
  };

  const insertExpression = (raw: string) => {
    if (modeRef.current === 'source' || !editorRef.current) {
      insertAtSelection(raw);
    } else {
      editorRef.current
        .chain()
        .focus()
        .insertContent({
          type: 'forumExpression',
          attrs: { raw }
        })
        .run();
    }
    setBuilder(null);
  };

  const transformSourceSelection = (transform: (selected: string) => string, block = false) => {
    const view = sourceViewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    const value = transform(selected);
    const before = view.state.sliceDoc(0, from);
    const after = view.state.sliceDoc(to);
    const prefix = block && before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    const suffix = block && after && !after.startsWith('\n\n') ? (after.startsWith('\n') ? '\n' : '\n\n') : '';
    const replacement = `${prefix}${value}${suffix}`;
    view.dispatch({
      changes: { from, to, insert: replacement },
      selection: { anchor: from + replacement.length },
      scrollIntoView: true
    });
    view.focus();
  };

  const insertSourceBlock = (markdown: string) => transformSourceSelection(() => markdown, true);

  const applyQuickFormat = (action: 'bold' | 'italic' | 'quote' | 'code' | 'list') => {
    if (modeRef.current === 'source') {
      transformSourceSelection(
        (selected) => {
          if (action === 'bold') return `**${selected || '粗体'}**`;
          if (action === 'italic') return `*${selected || '斜体'}*`;
          if (action === 'quote')
            return (selected || '引用内容')
              .split('\n')
              .map((line) => `> ${line}`)
              .join('\n');
          if (action === 'code')
            return selected.includes('\n') ? `\`\`\`\n${selected}\n\`\`\`` : `\`${selected || '代码'}\``;
          return (selected || '列表项')
            .split('\n')
            .map((line) => `- ${line}`)
            .join('\n');
        },
        action === 'quote' || action === 'list'
      );
      return;
    }
    const current = editorRef.current;
    if (!current) return;
    const chain = current.chain().focus();
    if (action === 'bold') chain.toggleBold().run();
    else if (action === 'italic') chain.toggleItalic().run();
    else if (action === 'quote') chain.toggleBlockquote().run();
    else if (action === 'code') chain.toggleCode().run();
    else chain.toggleBulletList().run();
  };

  const setHeading = (level: 0 | 1 | 2 | 3 | 4 | 5 | 6) => {
    if (modeRef.current === 'source') {
      transformSourceSelection((selected) => {
        const value = selected || '标题';
        if (level === 0) return value.replace(/^#{1,6}\s+/gm, '');
        return value
          .split('\n')
          .map((line) => `${'#'.repeat(level)} ${line.replace(/^#{1,6}\s+/, '')}`)
          .join('\n');
      }, level !== 0);
      return;
    }
    if (!editorRef.current) return;
    if (level === 0) editorRef.current.chain().focus().setParagraph().run();
    else editorRef.current.chain().focus().setHeading({ level }).run();
  };

  const applyLink = (href: string) => {
    if (modeRef.current === 'source') {
      transformSourceSelection((selected) => `[${selected || '链接文字'}](${href})`);
    } else {
      const current = editorRef.current;
      if (!current) return;
      if (current.state.selection.empty) insertMarkdown(current, `[链接文字](${href})`);
      else current.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
  };

  const uploadImage = async () => {
    if (imageBusyRef.current) return;
    imageBusyRef.current = true;
    setImageBusy(true);
    try {
      if (modeRef.current === 'rich' && editorRef.current) {
        await uploadImageAtSelection(editorRef.current);
        return;
      }
      const view = sourceViewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      const uploadRange = { from, to };
      sourceUploadRangeRef.current = uploadRange;
      const result = await requestHostAction('upload-image');
      const markdown = typeof result === 'string' ? result : (result as { markdown?: string })?.markdown;
      if (markdown && sourceViewRef.current === view && sourceUploadRangeRef.current === uploadRange) {
        view.dispatch({
          changes: { from: uploadRange.from, to: uploadRange.to, insert: markdown },
          selection: { anchor: uploadRange.from + markdown.length }
        });
        view.focus();
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '图片上传失败');
    } finally {
      sourceUploadRangeRef.current = null;
      imageBusyRef.current = false;
      setImageBusy(false);
    }
  };

  const runMoreAction = (action: 'strike' | 'underline' | 'ordered-list' | 'task-list' | 'code-block' | 'divider') => {
    const current = editorRef.current;
    if (modeRef.current === 'source') {
      if (action === 'strike') transformSourceSelection((selected) => `~~${selected || '删除线'}~~`);
      else if (action === 'underline') transformSourceSelection((selected) => `++${selected || '下划线'}++`);
      else if (action === 'ordered-list')
        transformSourceSelection(
          (selected) =>
            (selected || '列表项')
              .split('\n')
              .map((line, index) => `${index + 1}. ${line}`)
              .join('\n'),
          true
        );
      else if (action === 'task-list')
        transformSourceSelection(
          (selected) =>
            (selected || '任务项')
              .split('\n')
              .map((line) => `- [ ] ${line}`)
              .join('\n'),
          true
        );
      else if (action === 'code-block')
        transformSourceSelection((selected) => `\`\`\`\n${selected || '代码'}\n\`\`\``, true);
      else if (action === 'divider') insertSourceBlock('---');
    } else if (current) {
      const chain = current.chain().focus();
      if (action === 'strike') chain.toggleStrike().run();
      else if (action === 'underline') chain.toggleUnderline().run();
      else if (action === 'ordered-list') chain.toggleOrderedList().run();
      else if (action === 'task-list') chain.toggleTaskList().run();
      else if (action === 'code-block') chain.toggleCodeBlock().run();
      else if (action === 'divider') chain.setHorizontalRule().run();
    }
  };

  const openNodeSeekPoll = () => {
    const node = modeRef.current === 'rich' ? currentAtom(editor, 'pendingNodeSeekPoll') : null;
    if (node) {
      setPollTitle(String(node.attrs.title || ''));
      setPollMultiple(Boolean(node.attrs.multiple));
      setPollPublic(Boolean(node.attrs.isPublic));
      try {
        const options = JSON.parse(String(node.attrs.options || '[]'));
        setPollOptions(Array.isArray(options) ? options.map(String) : ['选项一', '选项二']);
      } catch {
        setPollOptions(['选项一', '选项二']);
      }
    } else {
      setPollTitle('');
      setPollOptions(['选项一', '选项二']);
      setPollMultiple(false);
      setPollPublic(false);
    }
    showBuilder('nodeseek-poll');
  };

  const saveNodeSeekPoll = () => {
    try {
      const selected = modeRef.current === 'rich' ? currentAtom(editor, 'pendingNodeSeekPoll') : null;
      const localId = String(
        selected?.attrs.localId || `poll_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      );
      const previousRemoteId = String(selected?.attrs.remoteId || '');
      const poll = normalizePendingNodeSeekPoll({
        localId,
        title: pollTitle,
        multiple: pollMultiple,
        isPublic: pollPublic,
        options: pollOptions,
        fingerprint: '',
        ...(previousRemoteId ? { remoteId: previousRemoteId } : {})
      });
      pendingPolls.set(poll.localId, poll);
      const attrs = { ...poll, options: JSON.stringify(poll.options) };
      if (modeRef.current === 'source') insertSourceBlock(nodeSeekPendingPollToken(poll.localId));
      else if (editor) insertBlockContent(editor, 'pendingNodeSeekPoll', attrs);
      setBuilder(null);
    } catch (error) {
      setBuilderError(error instanceof Error ? error.message : '投票内容不正确');
    }
  };

  const openStardust = () => {
    const node = modeRef.current === 'rich' ? currentAtom(editor, 'nodeSeekStardust') : null;
    setStardustAmount(String(node?.attrs.amount || 1));
    setStardustRefId(String(node?.attrs.refId ?? generateNodeSeekStardustRefId()));
    setStardustDescription(String(node?.attrs.description || 'Pay with Stardust'));
    setStardustOneTime(Boolean(node?.attrs.oneTime));
    showBuilder('stardust');
  };

  const saveStardust = () => {
    try {
      if (!config?.nodeSeekMemberId) throw new Error('当前 NodeSeek 账号尚未确认');
      const receive = {
        receiverMemberId: config.nodeSeekMemberId,
        amount: Number(stardustAmount),
        refId: Number(stardustRefId),
        description: stardustDescription,
        oneTime: stardustOneTime
      };
      const marker = serializeNodeSeekStardustReceive(receive);
      const attrs = { ...receive, modified: true, rawMarker: marker };
      if (modeRef.current === 'source') insertSourceBlock(marker);
      else if (editor) insertBlockContent(editor, 'nodeSeekStardust', attrs);
      setBuilder(null);
    } catch (error) {
      setBuilderError(error instanceof Error ? error.message : '收款卡片不正确');
    }
  };

  const loadLinuxDoPollCapabilities = () => {
    if (linuxPollCapabilities || linuxPollCapabilitiesRequestRef.current) return;
    setLinuxPollCapabilitiesBusy(true);
    setLinuxPollCapabilitiesError('');
    const request = requestHostAction('load-linuxdo-poll-capabilities');
    linuxPollCapabilitiesRequestRef.current = request;
    void request
      .then((result) => {
        if (linuxPollCapabilitiesRequestRef.current !== request) return;
        const parsed = linuxDoPollCapabilitiesSchema.safeParse(result);
        if (!parsed.success) throw new Error('原站投票配置格式不正确');
        setLinuxPollCapabilities(parsed.data);
      })
      .catch((error) => {
        if (linuxPollCapabilitiesRequestRef.current !== request) return;
        setLinuxPollCapabilitiesError(error instanceof Error ? error.message : '用户组加载失败');
      })
      .finally(() => {
        if (linuxPollCapabilitiesRequestRef.current !== request) return;
        linuxPollCapabilitiesRequestRef.current = null;
        setLinuxPollCapabilitiesBusy(false);
      });
  };

  const openLinuxPoll = () => {
    const selected = modeRef.current === 'rich' ? currentAtom(editor, 'forumPrivateBlock') : null;
    const parsed = selected?.attrs.kind === 'linuxdo-poll' ? parseLinuxDoPoll(String(selected.attrs.raw || '')) : null;
    setLinuxPoll(parsed || emptyLinuxDoPoll());
    setLinuxPollAdvanced(
      Boolean(
        parsed &&
        (parsed.type === 'number' ||
          parsed.type === 'ranked_choice' ||
          parsed.title ||
          parsed.dynamic ||
          parsed.groups.length ||
          parsed.close ||
          parsed.results !== 'always')
      )
    );
    showBuilder('linuxdo-poll');
    loadLinuxDoPollCapabilities();
  };

  const saveLinuxPoll = () => {
    try {
      const raw = serializeLinuxDoPoll(linuxPoll);
      if (modeRef.current === 'source') insertAtSelection(raw);
      else if (editor) insertBlockContent(editor, 'forumPrivateBlock', { kind: 'linuxdo-poll', raw });
      setBuilder(null);
    } catch (error) {
      setBuilderError(error instanceof Error ? error.message : '投票内容不正确');
    }
  };

  const insertPrivate = (kind: string) => {
    const values: Record<string, string> = {
      details: '[details="详情"]\n在这里输入内容\n[/details]',
      spoiler: '[spoiler]\n在这里输入隐藏内容\n[/spoiler]',
      footnote: '正文[^1]\n\n[^1]: 脚注内容',
      date: `[date=${new Date().toISOString().slice(0, 10)} time=12:00:00 timezone="Asia/Shanghai"]`,
      formula: '$$\nE = mc^2\n$$',
      toc: '[toc]',
      scrolling: '[wrap=scroll]\n滚动内容\n[/wrap]',
      mermaid: '```mermaid\ngraph TD\n  A --> B\n```',
      chart: '```chart\ntype: bar\nlabels: [A, B]\nseries: [1, 2]\n```',
      graphviz: '```graphviz\ndigraph G { A -> B }\n```',
      hardbreak: '\\\n'
    };
    const value = values[kind];
    if (kind === 'hardbreak' && modeRef.current === 'rich') editor?.chain().focus().setHardBreak().run();
    else if (value) insertAtSelection(value);
    setBuilder(null);
  };

  const loadTemplates = async () => {
    setTemplateBusy(true);
    setBuilderError('');
    try {
      const result = (await requestHostAction('load-linuxdo-templates')) as { templates?: TemplateSummary[] };
      setTemplates(Array.isArray(result?.templates) ? result.templates : []);
    } catch (error) {
      setBuilderError(error instanceof Error ? error.message : '模板读取失败');
    } finally {
      setTemplateBusy(false);
    }
  };

  const insertTemplate = (template: TemplateSummary) => {
    if (!template.content) {
      setBuilderError('模板没有返回正文');
      return;
    }
    insertAtSelection(template.content);
    setBuilder(null);
    void requestHostAction('use-linuxdo-template', { id: template.id }).catch(() => {
      runtimeError('template-usage-failed', '模板已插入，但使用次数记录失败', revisionRef.current);
    });
  };

  const insertTable = () => {
    if (modeRef.current === 'source') {
      insertSourceBlock('| 表头 1 | 表头 2 |\n| --- | --- |\n| 内容 | 内容 |');
      return;
    }
    const current = editorRef.current;
    if (!current) return;
    if (!current.isActive('table'))
      current.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    current.commands.focus();
  };

  const toolbar = (() => {
    if (!editor || !config) return null;
    const rich = mode === 'rich';
    return (
      <ComposerToolbarState editor={editor}>
        {(toolbarState) => (
          <div className="toolbar-stack">
            <div className="toolbar-shell">
              <EditorToolbar aria-label="回复常用工具栏" className="toolbar toolbar-scroll">
                {config.site === 'nodeseek' ? (
                  <EditorButton aria-label="表情" iconOnly type="button" onClick={() => showBuilder('stickers')}>
                    <EditorIcon name="smile" />
                  </EditorButton>
                ) : (
                  <EditorButton aria-label="表情" iconOnly type="button" onClick={() => showBuilder('emoji')}>
                    <EditorIcon name="smile" />
                  </EditorButton>
                )}
                <EditorButton
                  aria-label={imageBusy ? '上传中…' : '图片'}
                  disabled={imageBusy}
                  iconOnly
                  type="button"
                  onClick={() => void uploadImage()}
                >
                  <EditorIcon name="image" />
                </EditorButton>
                <EditorButton
                  active={rich && toolbarState.bold}
                  aria-label="粗体"
                  iconOnly
                  type="button"
                  onClick={() => applyQuickFormat('bold')}
                >
                  <EditorIcon name="bold" />
                </EditorButton>
                <EditorButton
                  active={rich && toolbarState.italic}
                  aria-label="斜体"
                  iconOnly
                  type="button"
                  onClick={() => applyQuickFormat('italic')}
                >
                  <EditorIcon name="italic" />
                </EditorButton>
                <EditorDropdown
                  label="段落与标题选项"
                  onCloseAutoFocus={() => {
                    if (modeRef.current === 'rich') editorRef.current?.commands.focus();
                    else sourceViewRef.current?.focus();
                  }}
                  trigger={
                    <EditorButton aria-label="段落与标题" aria-haspopup="menu" className="block-type" type="button">
                      {rich && toolbarState.heading ? `标题 ${toolbarState.heading}` : '正文'}
                      <EditorIcon name="chevronDown" />
                    </EditorButton>
                  }
                >
                  <EditorDropdownRadioGroup>
                    {([0, 1, 2, 3, 4, 5, 6] as const).map((level) => {
                      const label = level === 0 ? '正文' : `标题 ${level}`;
                      return (
                        <EditorDropdownRadioItem
                          checked={Number(rich ? toolbarState.heading || 0 : 0) === level}
                          key={level}
                          label={label}
                          onSelect={() => setHeading(level)}
                        >
                          {label}
                        </EditorDropdownRadioItem>
                      );
                    })}
                  </EditorDropdownRadioGroup>
                </EditorDropdown>
                <EditorButton
                  active={rich && toolbarState.strike}
                  aria-label="删除线"
                  iconOnly
                  type="button"
                  onClick={() => runMoreAction('strike')}
                >
                  <EditorIcon name="strike" />
                </EditorButton>
                {config.site === 'linuxdo' ? (
                  <EditorButton
                    active={rich && toolbarState.underline}
                    aria-label="下划线"
                    iconOnly
                    type="button"
                    onClick={() => runMoreAction('underline')}
                  >
                    <EditorIcon name="underline" />
                  </EditorButton>
                ) : null}
                <EditorLinkPopover
                  getInitialHref={() =>
                    modeRef.current === 'rich'
                      ? String(editorRef.current?.getAttributes('link').href || 'https://')
                      : 'https://'
                  }
                  onApply={applyLink}
                  onCloseAutoFocus={() => {
                    if (modeRef.current === 'rich') editorRef.current?.commands.focus();
                    else sourceViewRef.current?.focus();
                  }}
                  onRemove={
                    rich && editor.isActive('link')
                      ? () => editor.chain().focus().extendMarkRange('link').unsetLink().run()
                      : undefined
                  }
                  trigger={
                    <EditorButton aria-label="链接" iconOnly type="button">
                      <EditorIcon name="link" />
                    </EditorButton>
                  }
                />
                <EditorButton
                  active={rich && toolbarState.blockquote}
                  aria-label="引用"
                  iconOnly
                  type="button"
                  onClick={() => applyQuickFormat('quote')}
                >
                  <EditorIcon name="quote" />
                </EditorButton>
                <EditorButton
                  active={rich && toolbarState.code}
                  aria-label="代码"
                  iconOnly
                  type="button"
                  onClick={() => applyQuickFormat('code')}
                >
                  <EditorIcon name="code" />
                </EditorButton>
                <EditorDropdown
                  label="列表选项"
                  onCloseAutoFocus={() => {
                    if (modeRef.current === 'rich') editorRef.current?.commands.focus();
                    else sourceViewRef.current?.focus();
                  }}
                  trigger={
                    <EditorButton
                      active={
                        rich && Boolean(toolbarState.bulletList || toolbarState.orderedList || toolbarState.taskList)
                      }
                      aria-label="列表选项"
                      aria-haspopup="menu"
                      className="list-type"
                      type="button"
                    >
                      <EditorIcon name="list" />
                      <EditorIcon name="chevronDown" />
                    </EditorButton>
                  }
                >
                  <EditorDropdownRadioGroup>
                    <EditorDropdownRadioItem
                      checked={rich && toolbarState.bulletList}
                      label="无序列表"
                      onSelect={() => applyQuickFormat('list')}
                    >
                      无序列表
                    </EditorDropdownRadioItem>
                    <EditorDropdownRadioItem
                      checked={rich && toolbarState.orderedList}
                      label="有序列表"
                      onSelect={() => runMoreAction('ordered-list')}
                    >
                      有序列表
                    </EditorDropdownRadioItem>
                    <EditorDropdownRadioItem
                      checked={rich && toolbarState.taskList}
                      label="任务列表"
                      onSelect={() => runMoreAction('task-list')}
                    >
                      任务列表
                    </EditorDropdownRadioItem>
                  </EditorDropdownRadioGroup>
                </EditorDropdown>
                <EditorButton
                  active={rich && toolbarState.codeBlock}
                  aria-label="代码块"
                  iconOnly
                  type="button"
                  onClick={() => runMoreAction('code-block')}
                >
                  <EditorIcon name="codeBlock" />
                </EditorButton>
                <EditorButton aria-label="分隔线" iconOnly type="button" onClick={() => runMoreAction('divider')}>
                  <EditorIcon name="divider" />
                </EditorButton>
                <EditorButton
                  active={rich && toolbarState.table}
                  aria-label="表格"
                  iconOnly
                  type="button"
                  onClick={insertTable}
                >
                  <EditorIcon name="table" />
                </EditorButton>
                {config.site === 'nodeseek' && config.intentKind !== 'private-message' ? (
                  <>
                    <EditorButton aria-label="投票" type="button" onClick={openNodeSeekPoll}>
                      <EditorIcon name="poll" />
                      投票
                    </EditorButton>
                    <EditorButton aria-label="Stardust 收款" type="button" onClick={openStardust}>
                      <EditorIcon name="wallet" />
                      Stardust 收款
                    </EditorButton>
                  </>
                ) : null}
                {config.site === 'linuxdo' ? (
                  <>
                    <EditorButton aria-label="投票" type="button" onClick={openLinuxPoll}>
                      <EditorIcon name="poll" />
                      投票
                    </EditorButton>
                    <EditorButton aria-label="正文工具" type="button" onClick={() => showBuilder('private')}>
                      <EditorIcon name="tools" />
                      正文工具
                    </EditorButton>
                    <EditorButton
                      aria-label="动态模板"
                      type="button"
                      onClick={() => {
                        showBuilder('templates');
                        void loadTemplates();
                      }}
                    >
                      <EditorIcon name="template" />
                      动态模板
                    </EditorButton>
                  </>
                ) : null}
              </EditorToolbar>
            </div>
          </div>
        )}
      </ComposerToolbarState>
    );
  })();

  return (
    <main className="runtime" onInputCapture={() => builderError && setBuilderError('')}>
      {toolbar}
      <div className={mode === 'rich' ? 'editor-pane active' : 'editor-pane'} aria-hidden={mode !== 'rich'}>
        <EditorContent editor={editor} />
        {editor && mode === 'rich' ? <TableContextMenu editor={editor} /> : null}
      </div>
      <div
        ref={sourceHostRef}
        className={mode === 'source' ? 'source-pane active' : 'source-pane'}
        aria-hidden={mode !== 'source'}
      />
      {!config ? <div className="loading">正在初始化编辑器…</div> : null}

      {builder === 'nodeseek-poll' ? (
        <BuilderPanel title="NodeSeek 投票" onClose={() => setBuilder(null)}>
          <label className="tiptap-field">
            标题
            <EditorInput
              aria-label="投票标题"
              value={pollTitle}
              onChange={(event) => setPollTitle(event.target.value)}
            />
          </label>
          <PollOptionFields options={pollOptions} onChange={setPollOptions} />
          <label className="tiptap-field check">
            <input type="checkbox" checked={pollMultiple} onChange={(event) => setPollMultiple(event.target.checked)} />
            允许多选
          </label>
          <label className="tiptap-field check">
            <input type="checkbox" checked={pollPublic} onChange={(event) => setPollPublic(event.target.checked)} />
            公开投票人
          </label>
          {builderError ? <p className="error">{builderError}</p> : null}
          <EditorButton className="primary" type="button" onClick={saveNodeSeekPoll}>
            插入投票
          </EditorButton>
          <p className="hint">这里只保存本地草稿；发送回复前不会创建远端投票。</p>
        </BuilderPanel>
      ) : null}

      {builder === 'stardust' ? (
        <BuilderPanel title="Stardust 收款卡片" onClose={() => setBuilder(null)}>
          <label className="tiptap-field">
            收款人
            <EditorInput disabled value={config?.nodeSeekMemberId || '账号待确认'} />
          </label>
          <label className="tiptap-field">
            数额
            <EditorInput
              inputMode="numeric"
              value={stardustAmount}
              onChange={(event) => setStardustAmount(event.target.value)}
            />
          </label>
          <label className="tiptap-field">
            Ref ID
            <EditorInput
              inputMode="numeric"
              value={stardustRefId}
              onChange={(event) => setStardustRefId(event.target.value)}
            />
          </label>
          <label className="tiptap-field">
            备注
            <EditorInput value={stardustDescription} onChange={(event) => setStardustDescription(event.target.value)} />
          </label>
          <label className="tiptap-field check">
            <input
              type="checkbox"
              checked={stardustOneTime}
              onChange={(event) => setStardustOneTime(event.target.checked)}
            />
            一次性付款
          </label>
          {builderError ? <p className="error">{builderError}</p> : null}
          <EditorButton className="primary" type="button" onClick={saveStardust}>
            生成付款码
          </EditorButton>
          <p className="hint">生成卡片不会扣款，也不会发出网络请求。</p>
        </BuilderPanel>
      ) : null}

      {builder === 'linuxdo-poll' ? (
        <BuilderPanel title="LinuxDo 投票" onClose={() => setBuilder(null)}>
          <div className="tiptap-field">
            <span>类型</span>
            <div aria-label="投票类型" className="poll-type-segments" role="group">
              {(
                [
                  ['regular', '单选'],
                  ['multiple', '多选'],
                  ...(linuxPollAdvanced
                    ? ([
                        ['number', '数字'],
                        ['ranked_choice', '排序选择']
                      ] as const)
                    : [])
                ] as const
              ).map(([type, label]) => (
                <EditorButton
                  active={linuxPoll.type === type}
                  aria-label={label}
                  key={type}
                  type="button"
                  onClick={() => setLinuxPoll((value) => ({ ...value, type }))}
                >
                  {label}
                </EditorButton>
              ))}
            </div>
          </div>
          {linuxPoll.type !== 'number' ? (
            <PollOptionFields
              options={linuxPoll.options}
              onChange={(options) => setLinuxPoll((value) => ({ ...value, options }))}
            />
          ) : null}
          <EditorButton
            active={linuxPollAdvanced}
            aria-label={linuxPollAdvanced ? '收起高级设置' : '展开高级设置'}
            className="poll-advanced-toggle"
            type="button"
            onClick={() => setLinuxPollAdvanced((value) => !value)}
          >
            {linuxPollAdvanced ? '收起高级设置' : '高级设置'}
            <EditorIcon name="chevronDown" />
          </EditorButton>
          {!linuxPollAdvanced && linuxPollCapabilitiesBusy ? (
            <p className="hint" role="status">
              正在读取原站用户组…
            </p>
          ) : null}
          {!linuxPollAdvanced && linuxPollCapabilitiesError ? (
            <div className="inline-retry" role="alert">
              <span>{linuxPollCapabilitiesError}</span>
              <EditorButton type="button" onClick={loadLinuxDoPollCapabilities}>
                重试
              </EditorButton>
            </div>
          ) : null}
          {linuxPollAdvanced ? (
            <section aria-label="LinuxDo 投票高级设置" className="poll-advanced-fields">
              <label className="tiptap-field">
                标题（可选）
                <EditorInput
                  aria-label="投票标题"
                  value={linuxPoll.title}
                  onChange={(event) => setLinuxPoll((value) => ({ ...value, title: event.target.value }))}
                />
              </label>
              {linuxPoll.type === 'multiple' || linuxPoll.type === 'number' ? (
                <div className="field-row">
                  <label className="tiptap-field">
                    最小值
                    <EditorInput
                      inputMode="numeric"
                      type="number"
                      min="0"
                      value={linuxPoll.min}
                      onChange={(event) =>
                        setLinuxPoll((value) => ({ ...value, min: Number(event.target.value || 0) }))
                      }
                    />
                  </label>
                  <label className="tiptap-field">
                    最大值
                    <EditorInput
                      inputMode="numeric"
                      type="number"
                      min="0"
                      value={linuxPoll.max}
                      onChange={(event) =>
                        setLinuxPoll((value) => ({ ...value, max: Number(event.target.value || 0) }))
                      }
                    />
                  </label>
                  {linuxPoll.type === 'number' ? (
                    <label className="tiptap-field">
                      步长
                      <EditorInput
                        inputMode="numeric"
                        type="number"
                        min="1"
                        value={linuxPoll.step}
                        onChange={(event) =>
                          setLinuxPoll((value) => ({ ...value, step: Number(event.target.value || 0) }))
                        }
                      />
                    </label>
                  ) : null}
                </div>
              ) : null}
              <div className="tiptap-field">
                <span>结果显示</span>
                <EditorDropdown
                  label="结果显示"
                  trigger={
                    <EditorButton aria-label="结果显示" aria-haspopup="menu" className="field-dropdown" type="button">
                      <span>
                        {
                          {
                            always: '始终可见',
                            on_vote: '只在投票后',
                            on_close: '投票关闭后',
                            staff_only: '仅 Staff'
                          }[linuxPoll.results]
                        }
                      </span>
                      <EditorIcon name="chevronDown" />
                    </EditorButton>
                  }
                >
                  <EditorDropdownRadioGroup>
                    {(
                      [
                        ['always', '始终可见'],
                        ['on_vote', '只在投票后'],
                        ['on_close', '投票关闭后'],
                        ...(linuxPollCapabilities?.canUseStaffResults ? ([['staff_only', '仅 Staff']] as const) : [])
                      ] as const
                    ).map(([result, label]) => (
                      <EditorDropdownRadioItem
                        checked={linuxPoll.results === result}
                        key={result}
                        label={label}
                        onSelect={() => setLinuxPoll((value) => ({ ...value, results: result }))}
                      >
                        {label}
                      </EditorDropdownRadioItem>
                    ))}
                  </EditorDropdownRadioGroup>
                </EditorDropdown>
                {linuxPoll.results === 'staff_only' && !linuxPollCapabilities?.canUseStaffResults ? (
                  <p className="hint">原投票的 Staff 结果设置将原样保留；当前账号不能新建该设置。</p>
                ) : null}
              </div>
              {linuxPoll.type === 'regular' || linuxPoll.type === 'multiple' ? (
                <div className="tiptap-field">
                  <span>图表</span>
                  <EditorDropdown
                    label="图表"
                    trigger={
                      <EditorButton aria-label="图表" aria-haspopup="menu" className="field-dropdown" type="button">
                        <span>{linuxPoll.chartType === 'pie' ? '饼图' : '柱状图'}</span>
                        <EditorIcon name="chevronDown" />
                      </EditorButton>
                    }
                  >
                    <EditorDropdownRadioGroup>
                      {(
                        [
                          ['bar', '柱状图'],
                          ['pie', '饼图']
                        ] as const
                      ).map(([chartType, label]) => (
                        <EditorDropdownRadioItem
                          checked={linuxPoll.chartType === chartType}
                          key={chartType}
                          label={label}
                          onSelect={() => setLinuxPoll((value) => ({ ...value, chartType }))}
                        >
                          {label}
                        </EditorDropdownRadioItem>
                      ))}
                    </EditorDropdownRadioGroup>
                  </EditorDropdown>
                </div>
              ) : null}
              <label className="tiptap-field check">
                <input
                  type="checkbox"
                  checked={linuxPoll.publicPoll}
                  onChange={(event) => setLinuxPoll((value) => ({ ...value, publicPoll: event.target.checked }))}
                />
                显示投票人
              </label>
              <label className="tiptap-field check">
                <input
                  type="checkbox"
                  checked={linuxPoll.dynamic}
                  onChange={(event) => setLinuxPoll((value) => ({ ...value, dynamic: event.target.checked }))}
                />
                允许发布后添加或删除选项
              </label>
              <LinuxDoGroupChooser
                capabilities={linuxPollCapabilities}
                error={linuxPollCapabilitiesError}
                loading={linuxPollCapabilitiesBusy}
                selected={linuxPoll.groups}
                onChange={(groups) => setLinuxPoll((value) => ({ ...value, groups }))}
                onRetry={loadLinuxDoPollCapabilities}
              />
              <div className="tiptap-field">
                <span>自动关闭时间</span>
                <div className="field-row">
                  <EditorInput
                    aria-label="自动关闭日期"
                    type="date"
                    value={linuxDoPollCloseParts(linuxPoll.close).date}
                    onChange={(event) => {
                      const parts = linuxDoPollCloseParts(linuxPoll.close);
                      setLinuxPoll((value) => ({
                        ...value,
                        close: linuxDoPollCloseIso(event.target.value, parts.time)
                      }));
                    }}
                  />
                  <EditorInput
                    aria-label="自动关闭时间"
                    type="time"
                    disabled={!linuxDoPollCloseParts(linuxPoll.close).date}
                    value={linuxDoPollCloseParts(linuxPoll.close).time}
                    onChange={(event) => {
                      const parts = linuxDoPollCloseParts(linuxPoll.close);
                      setLinuxPoll((value) => ({
                        ...value,
                        close: linuxDoPollCloseIso(parts.date, event.target.value)
                      }));
                    }}
                  />
                </div>
              </div>
            </section>
          ) : null}
          {linuxPoll.unknownAttributes.length ? (
            <p className="hint">将保留 {linuxPoll.unknownAttributes.length} 个原站未知属性。</p>
          ) : null}
          {builderError ? <p className="error">{builderError}</p> : null}
          <EditorButton className="primary" type="button" onClick={saveLinuxPoll}>
            插入投票
          </EditorButton>
        </BuilderPanel>
      ) : null}

      {builder === 'private' ? (
        <BuilderPanel title="LinuxDo 正文工具" onClose={() => setBuilder(null)}>
          <div className="tool-grid">
            {[
              ['details', 'Details'],
              ['spoiler', 'Spoiler'],
              ['footnote', '脚注'],
              ['date', '日期/时间'],
              ['formula', '公式'],
              ['toc', 'ToC'],
              ['scrolling', '滚动内容'],
              ['mermaid', 'Mermaid'],
              ['chart', 'Build Chart'],
              ['graphviz', 'Graphviz'],
              ['hardbreak', '硬换行']
            ].map(([kind, label]) => (
              <EditorButton type="button" key={kind} onClick={() => insertPrivate(kind!)}>
                {label}
              </EditorButton>
            ))}
          </div>
        </BuilderPanel>
      ) : null}

      {builder === 'templates' ? (
        <BuilderPanel title="动态模板" onClose={() => setBuilder(null)}>
          {templateBusy ? <p>正在读取模板…</p> : null}
          {builderError ? <p className="error">{builderError}</p> : null}
          {!templateBusy && !templates.length && !builderError ? <p>没有可用模板</p> : null}
          <div className="template-list">
            {templates.map((template) => (
              <EditorButton
                disabled={templateBusy}
                type="button"
                key={template.id}
                onClick={() => void insertTemplate(template)}
              >
                {template.title}
              </EditorButton>
            ))}
          </div>
        </BuilderPanel>
      ) : null}

      {config?.site === 'nodeseek' ? (
        <div data-expression-cache="stickers" hidden={builder !== 'stickers'}>
          <BuilderPanel title="NodeSeek 贴纸" onClose={() => setBuilder(null)}>
            <div className="category-rail">
              {NODESEEK_STICKER_CATEGORIES.map((category) => (
                <EditorButton
                  active={category.label === stickerCategory}
                  type="button"
                  key={category.label}
                  onClick={() => setStickerCategory(category.label)}
                >
                  {category.label}
                </EditorButton>
              ))}
            </div>
            {NODESEEK_STICKER_CATEGORIES.map((category) => (
              <div className="expression-grid" hidden={category.label !== stickerCategory} key={category.label}>
                {category.items.map((item) => (
                  <ExpressionButton
                    label={item.label}
                    src={item.imageUrl}
                    visible={builder === 'stickers' && category.label === stickerCategory}
                    key={item.code}
                    onInsert={() => insertExpression(item.code)}
                  />
                ))}
              </div>
            ))}
          </BuilderPanel>
        </div>
      ) : null}

      {config?.site === 'linuxdo' ? (
        <div
          data-expression-cache="emoji"
          hidden={builder !== 'emoji'}
          onScrollCapture={(event) => {
            const target = event.target as HTMLElement;
            if (
              target.classList.contains('builder-body') &&
              target.scrollHeight - target.scrollTop - target.clientHeight <= 96 &&
              visibleEmoji.length < filteredEmoji.length
            ) {
              loadMoreEmoji();
            }
          }}
        >
          <BuilderPanel title="LinuxDo Emoji" onClose={() => setBuilder(null)}>
            <div className="expression-search">
              <EditorIcon name="search" />
              <EditorInput
                aria-label="搜索 Emoji"
                autoComplete="off"
                placeholder="搜索 Emoji"
                type="search"
                value={emojiQuery}
                onChange={(event) => setEmojiQuery(event.target.value)}
              />
            </div>
            <div className="expression-grid">
              {visibleEmoji.map((item) => (
                <ExpressionButton
                  label={item.name.replace(/_/g, ' ')}
                  src={item.url}
                  visible={builder === 'emoji'}
                  key={`${item.name}:${item.url}`}
                  onInsert={() => insertExpression(`:${item.name}:`)}
                >
                  <span>{item.name.replace(/_/g, ' ')}</span>
                </ExpressionButton>
              ))}
            </div>
            {!visibleEmoji.length ? (
              <p className="hint">{config.discourseEmoji.length ? '没有匹配的 Emoji' : '正在读取表情目录…'}</p>
            ) : null}
            {visibleEmoji.length < filteredEmoji.length ? (
              <EditorButton
                aria-label="加载更多 Emoji"
                className="expression-load-more"
                type="button"
                onClick={loadMoreEmoji}
              >
                加载更多
              </EditorButton>
            ) : null}
          </BuilderPanel>
        </div>
      ) : null}
    </main>
  );
}

const mount = document.getElementById('root');
if (mount) createRoot(mount).render(<ComposerEditorRuntime />);
