import { describe, expect, it } from 'vitest';
import {
  finishAbortableRequest,
  isCanceledRequest,
  isLinuxDoCloudflareError,
  isYaohuoLoginExpiredError,
  isYaohuoLoginRequiredError,
  linuxDoExternalSearchItems,
  sourceLabel,
  startAbortableRequest,
  topicListDisplayTime
} from './appUtils';
import { REQUEST_CANCELED_MESSAGE } from './request';

describe('Android app utils', () => {
  it('formats source labels and canceled request errors', () => {
    expect(sourceLabel('all')).toBe('全部');
    expect(sourceLabel('linuxdo')).toBe('linux.do');
    expect(sourceLabel('nodeseek')).toBe('NodeSeek');
    expect(sourceLabel('yaohuo')).toBe('妖火');
    expect(sourceLabel('v2ex')).toBe('V2EX');
    expect(isCanceledRequest(new Error(REQUEST_CANCELED_MESSAGE))).toBe(true);
  });

  it('starts and finishes abortable requests by controller identity', () => {
    const ref: { current: AbortController | null } = { current: null };
    const first = startAbortableRequest(ref);
    const second = startAbortableRequest(ref);

    expect(first.signal.aborted).toBe(true);
    expect(ref.current).toBe(second);
    expect(finishAbortableRequest(ref, first)).toBe(false);
    expect(ref.current).toBe(second);
    expect(finishAbortableRequest(ref, second)).toBe(true);
    expect(ref.current).toBeNull();
  });

  it('distinguishes expired yaohuo login from access verification', () => {
    const expired = Object.assign(new Error('expired'), { loginRequired: true, reason: 'expired' });
    const verification = Object.assign(new Error('verification'), { loginRequired: true, reason: 'verification' });

    expect(isYaohuoLoginRequiredError(expired)).toBe(true);
    expect(isYaohuoLoginExpiredError(expired)).toBe(true);
    expect(isYaohuoLoginRequiredError(verification)).toBe(true);
    expect(isYaohuoLoginExpiredError(verification)).toBe(false);
  });

  it('identifies linux.do Cloudflare verification errors', () => {
    const cloudflare = Object.assign(new Error('linux.do 需要完成 Cloudflare 验证'), {
      source: 'linuxdo',
      reason: 'cloudflare'
    });
    const ordinary = Object.assign(new Error('linux.do 主题不存在'), {
      source: 'linuxdo'
    });

    expect(isLinuxDoCloudflareError(cloudflare)).toBe(true);
    expect(isLinuxDoCloudflareError(ordinary)).toBe(false);
  });

  it('builds linux.do external search shortcuts like the mobile web search page', () => {
    expect(linuxDoExternalSearchItems('  gpt plus  ')).toEqual([
      { label: 'Google', url: 'https://www.google.com/search?q=site%3Alinux.do%20gpt%20plus' },
      { label: 'Bing', url: 'https://www.bing.com/search?q=site%3Alinux.do%20gpt%20plus' },
      { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=site%3Alinux.do%20gpt%20plus' }
    ]);
    expect(linuxDoExternalSearchItems('')).toEqual([]);
  });

  it('uses active time for V2EX list display time', () => {
    expect(topicListDisplayTime({
      source: 'v2ex',
      createdAt: '2026-05-24T08:50:00.000Z',
      lastReplyAt: '2026-05-24T06:00:00.000Z'
    })).toBe('2026-05-24T06:00:00.000Z');
    expect(topicListDisplayTime({
      source: 'linuxdo',
      createdAt: '2026-05-24T08:50:00.000Z',
      lastReplyAt: '2026-05-24T09:00:00.000Z'
    })).toBe('2026-05-24T09:00:00.000Z');
  });
});
