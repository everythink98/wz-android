import { type MutableRefObject } from 'react';
import { REQUEST_CANCELED_MESSAGE } from './request';
import type { FeedSource, Source } from './types';

export function sourceLabel(source: Source | FeedSource) {
  if (source === 'all') {
    return '全部';
  }
  if (source === 'linuxdo') {
    return 'linux.do';
  }
  if (source === 'nodeseek') {
    return 'NodeSeek';
  }
  if (source === 'yaohuo') {
    return '妖火';
  }
  return 'V2EX';
}

export function isYaohuoLoginRequiredError(error: unknown) {
  return Boolean(
    error
    && typeof error === 'object'
    && 'loginRequired' in error
    && (error as { loginRequired?: unknown }).loginRequired
  );
}

export function formatDateTime(value?: string) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatRelativeTime(value?: string) {
  const time = dateTime(value);
  if (!time) {
    return '';
  }
  const diff = Date.now() - time;
  if (diff < 60_000) {
    return '刚刚';
  }
  if (diff < 60 * 60_000) {
    return `${Math.floor(diff / 60_000)} 分钟前`;
  }
  if (diff < 24 * 60 * 60_000) {
    return `${Math.floor(diff / (60 * 60_000))} 小时前`;
  }
  return `${Math.floor(diff / (24 * 60 * 60_000))} 天前`;
}

export function dateTime(value?: string) {
  if (!value) {
    return 0;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败';
}

export function isCanceledRequest(error: unknown) {
  return error instanceof Error && error.message === REQUEST_CANCELED_MESSAGE;
}

export function startAbortableRequest(ref: MutableRefObject<AbortController | null>) {
  ref.current?.abort();
  const controller = new AbortController();
  ref.current = controller;
  return controller;
}

export function finishAbortableRequest(ref: MutableRefObject<AbortController | null>, controller: AbortController) {
  if (ref.current === controller) {
    ref.current = null;
  }
}

export function settingsList(value: string[]) {
  return Array.isArray(value) ? value : [];
}

export function appendUnique(items: string[], value: string) {
  const clean = value.trim();
  if (!clean) {
    return items;
  }
  return [clean, ...items.filter((item) => item.toLowerCase() !== clean.toLowerCase())].slice(0, 100);
}

export function removeString(items: string[], value: string) {
  return items.filter((item) => item !== value);
}
