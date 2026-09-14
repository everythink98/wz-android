import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppState } from 'react-native';
import { recordUserInteraction, userPresent } from '@/platform/network/userPresence';
import { beginDiagnosticTrace, setDiagnosticWriter, withDiagnosticFetcher } from '@/platform/diagnostics/diagnostics';
import type { Fetcher } from '@/platform/network/request';
import { withLinuxDoPresence } from './presence';
import { createLinuxDoReadingSender } from './reading';
import { fetchLinuxDoJson } from './reader';

vi.mock('react-native', () => ({ AppState: { currentState: 'active' } }));

afterEach(() => {
  vi.restoreAllMocks();
  setDiagnosticWriter(null);
  AppState.currentState = 'active';
});

describe('LinuxDo presence at dispatch', () => {
  it('keeps standalone reader requests free of foreground presence', async () => {
    recordUserInteraction();
    const dispatch = vi.fn<Fetcher>(async () => new Response('{}'));
    await fetchLinuxDoJson('/notifications.json', undefined, { fetcher: dispatch });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const headers = new Headers(dispatch.mock.calls[0][1]?.headers);
    expect(headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    expect(headers.has('Discourse-Present')).toBe(false);
  });

  it('preserves caller cancellation through the reader and decorated transport', async () => {
    recordUserInteraction();
    const controller = new AbortController();
    const dispatch = vi.fn<Fetcher>(async (_url, init) => {
      expect(new Headers(init?.headers).get('Discourse-Present')).toBe('true');
      controller.abort();
      expect(init?.signal?.aborted).toBe(true);
      throw new DOMException('Aborted', 'AbortError');
    });
    await expect(
      fetchLinuxDoJson('/latest.json', undefined, {
        fetcher: withLinuxDoPresence(dispatch),
        signal: controller.signal
      })
    ).rejects.toMatchObject({ name: 'RequestCanceledError' });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it('expires without a timer and only real foreground input renews presence', async () => {
    let now = 100_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    recordUserInteraction();
    now += 59_000;
    expect(userPresent()).toBe(true);
    now += 1000;
    expect(userPresent()).toBe(false);
    const fetcher = withLinuxDoPresence(async () => new Response(''));
    await fetcher('https://linux.do/latest.json', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    expect(userPresent()).toBe(false);
    AppState.currentState = 'background';
    recordUserInteraction();
    AppState.currentState = 'active';
    expect(userPresent()).toBe(false);
    recordUserInteraction();
    expect(userPresent()).toBe(true);
    AppState.currentState = 'unknown';
    expect(userPresent()).toBe(false);
    AppState.currentState = 'inactive';
    expect(userPresent()).toBe(false);
  });

  it('preserves request data and records only the final header under the existing trace', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    recordUserInteraction();
    const dispatch = vi.fn<Fetcher>(async () => new Response(''));
    const trace = beginDiagnosticTrace('source', 'reading-timings', { source: 'linuxdo' });
    const fetcher = withDiagnosticFetcher(trace, withLinuxDoPresence(dispatch));
    const headers = new Headers({ 'x-requested-with': 'XMLHttpRequest', 'Discourse-Background': 'true' });
    const signal = new AbortController().signal;
    const init = { headers, signal, method: 'POST', body: 'topic_id=12', credentials: 'include' as const };
    await fetcher('https://linux.do/topics/timings', init);
    expect(headers.has('Discourse-Present')).toBe(false);
    const sent = dispatch.mock.calls[0][1]!;
    expect(sent).toMatchObject({ signal, method: 'POST', body: init.body, credentials: 'include' });
    expect(new Headers(sent.headers).get('Discourse-Background')).toBe('true');
    AppState.currentState = 'background';
    await fetcher('https://linux.do/topics/timings', { ...init, headers: new Headers(sent.headers) });
    expect(new Headers(dispatch.mock.calls[1][1]?.headers).has('Discourse-Present')).toBe(false);
    const fields = lines
      .map((line) => JSON.parse(line))
      .filter((event) => typeof event.hasDiscoursePresent === 'boolean');
    expect(fields.map((event) => event.hasDiscoursePresent)).toEqual([true, false]);
    expect(fields.every((event) => event.traceId === trace.traceId && event.requestId)).toBe(true);
    expect(lines.join('')).not.toContain('lastInteractionAt');
  });

  it.each([
    'https://connect.linux.do/',
    'https://linux.do:444/latest.json',
    'http://linux.do/latest.json',
    'https://example.com/',
    'invalid'
  ])('does not modify requests outside the exact origin: %s', async (url) => {
    const dispatch = vi.fn<Fetcher>(async () => new Response(''));
    const init = { headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    await withLinuxDoPresence(dispatch)(url, init);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(url, init);
    expect(dispatch.mock.calls[0][1]).toBe(init);
  });

  it('leaves HTML and media requests untouched', async () => {
    const dispatch = vi.fn<Fetcher>(async () => new Response(''));
    const init = { headers: { Accept: 'text/html' } };
    await withLinuxDoPresence(dispatch)('https://linux.do/', init);
    expect(dispatch.mock.calls[0][1]).toBe(init);
  });

  it('rechecks presence after CSRF and on the existing bounded CSRF retry', async () => {
    recordUserInteraction();
    let csrfCount = 0;
    const posts: RequestInit[] = [];
    const dispatch: Fetcher = async (url, init) => {
      if (url.endsWith('/session/csrf')) {
        AppState.currentState = ++csrfCount === 1 ? 'background' : 'active';
        if (csrfCount === 2) recordUserInteraction();
        return new Response(JSON.stringify({ csrf: 'fixture' }));
      }
      posts.push(init!);
      return posts.length === 1 ? new Response('["BAD CSRF"]', { status: 403 }) : new Response('');
    };
    const sender = createLinuxDoReadingSender({
      fetcher: withLinuxDoPresence(dispatch),
      scope: () => 'alice',
      userAgent: () => 'fixture'
    });
    await sender({ topicId: '12', topicTime: 1000, timings: { 1: 1000 } }, 'alice', new AbortController().signal);
    expect(csrfCount).toBe(2);
    expect(posts.map((init) => new Headers(init.headers).get('Discourse-Present'))).toEqual([null, 'true']);
    expect(posts[0].body).toBe(posts[1].body);
  });
});
