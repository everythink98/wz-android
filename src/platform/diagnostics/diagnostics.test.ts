import { afterEach, describe, expect, it } from 'vitest';
import {
  beginDiagnosticTrace,
  diagnosticTraceForRequest,
  finishDiagnosticTrace,
  hintDiagnosticOutcome,
  markDiagnosticStage,
  recordDiagnosticError,
  registerDiagnosticContextFetcher,
  setDiagnosticWriter,
  withDiagnosticFetcher
} from './diagnostics';
import {
  type DiagnosticFields,
  diagnosticRef,
  linkDiagnosticRefs,
  normalizeDiagnosticReason
} from './diagnosticPolicy';

function captureEvents() {
  const lines: string[] = [];
  setDiagnosticWriter((line) => {
    lines.push(line);
  });
  return () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

afterEach(() => {
  setDiagnosticWriter(null);
});

describe('diagnostic traces', () => {
  it('correlates a trace from intent to one timed terminal event', () => {
    const events = captureEvents();
    const trace = beginDiagnosticTrace('feed', 'load', { source: 'v2ex' }, 1_000);

    finishDiagnosticTrace(trace, 'failure', { reason: 'network_error' }, 1_250);
    finishDiagnosticTrace(trace, 'success', {}, 1_500);

    expect(events()).toEqual([
      expect.objectContaining({
        appSessionId: trace.appSessionId,
        traceId: trace.traceId,
        area: 'feed',
        operation: 'load',
        phase: 'intent',
        outcome: 'success',
        durationMs: 0,
        source: 'v2ex'
      }),
      expect.objectContaining({
        appSessionId: trace.appSessionId,
        traceId: trace.traceId,
        phase: 'finish',
        outcome: 'failure',
        durationMs: 250,
        reason: 'network_error'
      })
    ]);
  });

  it('REG-ACCOUNT-038 records only sanitized NodeImage authorization stages', () => {
    const events = captureEvents();
    const trace = beginDiagnosticTrace('credential', 'auth', {
      credentialSource: 'nodeimage',
      nonce: 'nonce-secret',
      state: 'session-check'
    });

    for (const state of ['session-expired', 'connect-started', 'connect-finished', 'key-saved']) {
      markDiagnosticStage(trace, 'credential', {
        apiKey: 'api-key-secret',
        payload: 'payload-secret',
        state
      });
    }
    finishDiagnosticTrace(trace, 'success');

    expect(events().flatMap((event) => (event.state ? [event.state] : []))).toEqual([
      'session-check',
      'session-expired',
      'connect-started',
      'connect-finished',
      'key-saved'
    ]);
    expect(JSON.stringify(events())).not.toMatch(/nonce-secret|api-key-secret|payload-secret|nonce|apiKey|payload/);
  });

  it('REG-ACCOUNT-040 records only the classified NodeImage timeout result', () => {
    const events = captureEvents();
    const trace = beginDiagnosticTrace('credential', 'auth', {
      credentialSource: 'nodeimage',
      state: 'session-check'
    });

    markDiagnosticStage(trace, 'guard', {
      apiKey: 'api-key-secret',
      nonce: 'nonce-secret',
      payload: 'payload-secret',
      state: 'timeout',
      url: 'https://www.nodeseek.com/connect?target=secret'
    });
    finishDiagnosticTrace(trace, 'failure', {
      documentUrl: 'https://www.nodeimage.com/?secret=1',
      reason: 'timeout'
    });

    expect(events()).toEqual([
      expect.objectContaining({ state: 'session-check' }),
      expect.objectContaining({ phase: 'guard', state: 'timeout' }),
      expect.objectContaining({
        outcome: 'failure',
        phase: 'finish',
        reason: 'timeout'
      })
    ]);
    expect(JSON.stringify(events())).not.toMatch(
      /api-key-secret|nonce-secret|payload-secret|target=secret|secret=1|apiKey|nonce|payload|documentUrl|url/
    );
  });

  it('records only classified request metadata around a fetch', async () => {
    const events = captureEvents();
    const trace = beginDiagnosticTrace('network', 'request');
    const fetcher = withDiagnosticFetcher(
      trace,
      async () =>
        new Response('ok', {
          status: 200,
          headers: {
            'content-length': '2',
            'content-type': 'text/plain; charset=utf-8'
          }
        })
    );

    await fetcher('https://www.nodeseek.com/private/topic?token=FAKE_SECRET', {
      method: 'POST',
      headers: { authorization: 'Bearer FAKE_SECRET' }
    });

    const output = events().filter((event) => event.phase === 'transport');
    expect(output).toEqual([
      expect.objectContaining({ endpoint: 'action', method: 'POST', state: 'start' }),
      expect.objectContaining({
        endpoint: 'action',
        method: 'POST',
        state: 'finish',
        status: 200,
        contentType: 'text/plain',
        byteCount: 2,
        outcome: 'success'
      })
    ]);
    expect(JSON.stringify(output)).not.toMatch(/private|topic|token|FAKE_SECRET|authorization|Bearer/);
  });

  it('exposes the parent trace to nested transport fallbacks only while the request is active', async () => {
    const events = captureEvents();
    const trace = beginDiagnosticTrace('topic', 'open');
    const init = Object.freeze({ method: 'GET' }) satisfies RequestInit;
    let nestedTrace: unknown;
    const fetcher = withDiagnosticFetcher(trace, async (_input, nestedInit) => {
      nestedTrace = diagnosticTraceForRequest(nestedInit);
      return new Response('ok');
    });

    await fetcher('https://linux.do/t/42.json', init);

    expect(nestedTrace).toBe(trace);
    expect(diagnosticTraceForRequest(init)).toBeUndefined();
    expect(events().filter((event) => event.phase === 'intent')).toHaveLength(1);
  });

  it('preserves an absent RequestInit for fetchers that do not need nested context', async () => {
    const trace = beginDiagnosticTrace('media', 'save-image');
    let receivedInit: RequestInit | undefined = { method: 'POST' };
    const fetcher = withDiagnosticFetcher(trace, async (_input, init) => {
      receivedInit = init;
      return new Response('ok');
    });

    await fetcher('https://example.com/image.jpg');

    expect(receivedInit).toBeUndefined();
  });

  it('keeps media diagnostics categorical and drops URLs', () => {
    const events = captureEvents();
    const trace = beginDiagnosticTrace('media', 'load', {
      source: 'linuxdo',
      surface: 'preview',
      mediaClass: 'cross-source',
      url: 'https://secret.example/private.png?token=secret'
    });
    finishDiagnosticTrace(trace, 'failure', { fallback: 'svg', terminalReason: 'fallback-error' });

    expect(events().at(-1)).toEqual(
      expect.objectContaining({
        fallback: 'svg',
        terminalReason: 'fallback-error'
      })
    );
    expect(JSON.stringify(events())).not.toContain('secret.example');
  });

  it('keeps privacy-safe media timing, cache and rendition summaries', () => {
    const events = captureEvents();
    const privateUrl = 'https://secret.example/private.png?token=ULTRA_FAKE_SECRET_9';
    const mediaRef = diagnosticRef('media', privateUrl);
    const trace = beginDiagnosticTrace('media', 'load', {
      candidateKind: 'srcset',
      mediaRef,
      mediaRole: 'body'
    });

    finishDiagnosticTrace(trace, 'success', {
      cacheType: 'memory',
      displayMs: 41,
      firstProgressMs: 7,
      loadedBytes: 8192,
      loadMs: 35,
      sourceHeight: 720,
      sourceWidth: 1280,
      totalBytes: 8192
    });

    expect(events()[0]).toEqual(
      expect.objectContaining({
        candidateKind: 'srcset',
        mediaRef,
        mediaRole: 'body'
      })
    );
    expect(events().at(-1)).toEqual(
      expect.objectContaining({
        cacheType: 'memory',
        displayMs: 41,
        firstProgressMs: 7,
        loadedBytes: 8192,
        loadMs: 35,
        sourceHeight: 720,
        sourceWidth: 1280,
        totalBytes: 8192
      })
    );
    expect(mediaRef).toMatch(/^media-\d+$/);
    expect(JSON.stringify(events())).not.toMatch(/secret\.example|ULTRA_FAKE_SECRET_9/);
  });

  it('provides a temporary request context when the caller omits init', async () => {
    const trace = beginDiagnosticTrace('topic', 'open');
    let nestedInit: RequestInit | undefined;
    let nestedTrace: unknown;
    const fetcher = withDiagnosticFetcher(
      trace,
      registerDiagnosticContextFetcher(async (_input, receivedInit) => {
        nestedInit = receivedInit;
        nestedTrace = diagnosticTraceForRequest(receivedInit);
        return new Response('ok');
      })
    );

    await fetcher('https://linux.do/t/42.json');

    expect(nestedTrace).toBe(trace);
    expect(nestedInit).toBeDefined();
    expect(diagnosticTraceForRequest(nestedInit)).toBeUndefined();
  });

  it('records a normalized transport failure and rethrows the original error', async () => {
    const events = captureEvents();
    const trace = beginDiagnosticTrace('network', 'request');
    const failure = new TypeError('Network request failed');
    const init: RequestInit = { method: 'GET' };
    const fetcher = withDiagnosticFetcher(trace, async () => {
      throw failure;
    });

    await expect(fetcher('https://example.com/private?token=ULTRA_FAKE_SECRET_9', init)).rejects.toBe(failure);
    expect(diagnosticTraceForRequest(init)).toBeUndefined();

    expect(
      events()
        .filter((event) => event.phase === 'transport')
        .at(-1)
    ).toEqual(
      expect.objectContaining({
        endpoint: 'external',
        state: 'failure',
        outcome: 'failure',
        reason: 'network_error'
      })
    );
    expect(JSON.stringify(events())).not.toMatch(/example\.com|private|token|ULTRA_FAKE_SECRET_9/);
  });

  it('keeps safe stage summaries on the same trace and ignores stages after finish', () => {
    const events = captureEvents();
    const trace = beginDiagnosticTrace('topic', 'parse-topic');

    markDiagnosticStage(trace, 'parse', {
      candidateCount: 4,
      validCount: 3,
      droppedCount: 1,
      parserVariant: 'html-topic'
    });
    finishDiagnosticTrace(trace, 'partial');
    markDiagnosticStage(trace, 'apply', { itemCount: 3 });

    expect(events().map((event) => event.phase)).toEqual(['intent', 'parse', 'finish']);
    expect(events()[1]).toEqual(
      expect.objectContaining({
        traceId: trace.traceId,
        candidateCount: 4,
        validCount: 3,
        droppedCount: 1,
        parserVariant: 'html-topic'
      })
    );
  });

  it.each([
    'xiaoyinsi-discourse-categories',
    'xiaoyinsi-discourse-feed',
    'xiaoyinsi-discourse-replies',
    'xiaoyinsi-discourse-search',
    'xiaoyinsi-discourse-topic',
    'xiaoyinsi-discourse-user'
  ])('keeps the allowlisted 小隐寺 parser variant %s', (parserVariant) => {
    const events = captureEvents();
    const trace = beginDiagnosticTrace('topic', 'parse-topic');

    markDiagnosticStage(trace, 'parse', { parserVariant });

    expect(events().at(-1)).toEqual(expect.objectContaining({ parserVariant }));
  });

  it('upgrades a successful terminal event to the most severe hinted outcome', () => {
    const events = captureEvents();
    const trace = beginDiagnosticTrace('topic', 'open');

    hintDiagnosticOutcome(trace, 'partial', { partialErrorCount: 1 });
    hintDiagnosticOutcome(trace, 'failure', { reason: 'parse_empty', candidateCount: 0 });
    hintDiagnosticOutcome(trace, 'partial', { droppedCount: 2 });
    finishDiagnosticTrace(trace, 'success', { source: 'v2ex', state: 'applied' });

    expect(events().at(-1)).toEqual(
      expect.objectContaining({
        phase: 'finish',
        outcome: 'failure',
        source: 'v2ex',
        state: 'applied',
        reason: 'parse_empty',
        candidateCount: 0,
        droppedCount: 2,
        partialErrorCount: 1
      })
    );
  });

  it.each([
    ['success', 'partial', 'partial'],
    ['noop', 'partial', 'partial'],
    ['partial', 'failure', 'failure']
  ] as const)('upgrades a %s terminal event from a %s hint', (outcome, hint, expected) => {
    const events = captureEvents();
    const trace = beginDiagnosticTrace('topic', 'open');

    hintDiagnosticOutcome(trace, hint);
    finishDiagnosticTrace(trace, outcome);

    expect(events().at(-1)).toEqual(expect.objectContaining({ outcome: expected }));
  });

  it.each([
    ['blocked', 'login_required'],
    ['canceled', 'canceled'],
    ['stale', 'stale'],
    ['failure', 'network_error']
  ] as const)('keeps an explicit %s terminal event ahead of adapter hints', (outcome, reason) => {
    const events = captureEvents();
    const trace = beginDiagnosticTrace('topic', 'open');

    hintDiagnosticOutcome(trace, 'failure', { reason: 'parse_empty', candidateCount: 0 });
    finishDiagnosticTrace(trace, outcome, { reason });
    hintDiagnosticOutcome(trace, 'partial', { partialErrorCount: 1 });
    finishDiagnosticTrace(trace, 'success');

    expect(events().filter((event) => event.phase === 'finish')).toEqual([
      expect.objectContaining({ outcome, reason })
    ]);
    expect(events().at(-1)).not.toHaveProperty('candidateCount');
  });

  it('keeps only allowlisted scalar facts and removes paths and credentials', () => {
    const events = captureEvents();
    const unsafeFields = {
      endpoint: 'https://linux.do/users/private?token=ULTRA_FAKE_SECRET_9',
      channel: 'webview',
      state: 'session-expired',
      itemCount: 3,
      replyOrder: 'newest',
      positionKind: 'target',
      resolvedPage: 5,
      hasCookie: true,
      mutationReason: 'password=ULTRA_FAKE_SECRET_9',
      unknown: 'ULTRA_FAKE_SECRET_9',
      payload: { token: 'ULTRA_FAKE_SECRET_9' }
    } as unknown as DiagnosticFields;

    beginDiagnosticTrace('source', '/users/private?token=ULTRA_FAKE_SECRET_9', unsafeFields, 1_000);

    expect(events()[0]).toEqual(
      expect.objectContaining({
        operation: 'unknown',
        endpoint: 'user',
        channel: 'webview',
        state: 'session-expired',
        itemCount: 3,
        replyOrder: 'newest',
        positionKind: 'target',
        resolvedPage: 5,
        hasCookie: true,
        mutationReason: 'redacted'
      })
    );
    expect(events()[0]).not.toHaveProperty('unknown');
    expect(events()[0]).not.toHaveProperty('payload');
    expect(JSON.stringify(events())).not.toMatch(/users|private|token|ULTRA_FAKE_SECRET_9|password/);
  });

  it('rejects identifier-shaped private text hidden in allowlisted string fields', () => {
    const events = captureEvents();
    const fallbackByField = {
      source: 'redacted',
      site: 'redacted',
      endpoint: 'unknown',
      method: 'OTHER',
      contentType: 'unknown',
      reason: 'unknown',
      variant: 'redacted',
      channel: 'redacted',
      state: 'redacted',
      previousState: 'redacted',
      nextState: 'redacted',
      owner: 'redacted',
      priority: 'redacted',
      store: 'redacted',
      provider: 'redacted',
      route: 'redacted',
      routeKind: 'redacted',
      emptyReason: 'redacted',
      mutationReason: 'redacted',
      action: 'redacted',
      mode: 'redacted',
      flow: 'redacted',
      requestType: 'redacted',
      credentialSource: 'redacted',
      parserVariant: 'redacted',
      transport: 'redacted',
      kind: 'redacted',
      screen: 'redacted',
      section: 'redacted',
      protocol: 'redacted',
      eventType: 'redacted',
      result: 'redacted',
      level: 'redacted',
      queueState: 'redacted',
      csrfSource: 'redacted',
      userAgentSource: 'redacted',
      errorName: 'Error',
      message: 'unknown',
      stack: 'redacted',
      topicRef: 'redacted',
      userRef: 'redacted',
      cursorRef: 'redacted'
    } as const;

    beginDiagnosticTrace('search', 'PRIVATE_OPERATION_91827');
    for (const key of Object.keys(fallbackByField)) {
      beginDiagnosticTrace('search', 'request', {
        [key]: key === 'route' ? 'codex' : `PRIVATE_${key}_91827`
      });
    }

    expect(events()[0]).toEqual(expect.objectContaining({ operation: 'unknown' }));
    Object.entries(fallbackByField).forEach(([key, fallback], index) => {
      expect(events()[index + 1]?.[key]).toBe(fallback);
    });
    expect(JSON.stringify(events())).not.toMatch(/PRIVATE_|codex|PrivateError/);
  });

  it('rejects invented numeric fields, forged references and attacker-controlled MIME tokens', () => {
    const events = captureEvents();

    beginDiagnosticTrace('network', 'request', {
      privateCount: 91827,
      privateStatus: 40123,
      topicRef: 'topic-91827',
      contentType: 'export-secret/private'
    });

    expect(events()[0]).toEqual(
      expect.objectContaining({
        topicRef: 'redacted',
        contentType: 'other'
      })
    );
    expect(events()[0]).not.toHaveProperty('privateCount');
    expect(events()[0]).not.toHaveProperty('privateStatus');
    expect(JSON.stringify(events()[0])).not.toMatch(/91827|40123|export-secret|private/);
  });

  it('classifies same-site requests by fixed endpoint type without retaining paths', async () => {
    const events = captureEvents();
    const trace = beginDiagnosticTrace('network', 'request');
    const fetcher = withDiagnosticFetcher(
      trace,
      async () =>
        new Response('{}', {
          headers: { 'content-type': 'application/problem+json' }
        })
    );

    await fetcher('https://www.nodeseek.com/api/account/getInfo/91827?token=SECRET');
    await fetcher('https://www.nodeseek.com/api/content/list-comments?uid=91827');

    const starts = events().filter((event) => event.phase === 'transport' && event.state === 'start');
    expect(starts).toEqual([
      expect.objectContaining({ endpoint: 'user' }),
      expect.objectContaining({ endpoint: 'replies' })
    ]);
    expect(
      events()
        .filter((event) => event.contentType)
        .every((event) => event.contentType === 'application/json')
    ).toBe(true);
    expect(JSON.stringify(events())).not.toMatch(/getInfo|list-comments|91827|SECRET/);
  });

  it('uses stable, non-reversible references within the app session', () => {
    const firstTopic = diagnosticRef('topic', 'real-topic-id-91827');

    expect(diagnosticRef('topic', 'real-topic-id-91827')).toBe(firstTopic);
    expect(diagnosticRef('topic', 'another-real-topic-id')).not.toBe(firstTopic);
    expect(diagnosticRef('user', 'real-topic-id-91827')).toMatch(/^user-\d+$/);
    expect(firstTopic).toMatch(/^topic-\d+$/);
    expect(firstTopic).not.toContain('91827');
  });

  it('[REG-PERF-007] bounds raw and issued diagnostic references without reusing IDs', () => {
    const rawAnchor = 'diagnostic-raw-cap-anchor';
    const firstRawRef = diagnosticRef('cursor', rawAnchor);
    for (let index = 0; index < 4_097; index += 1) {
      diagnosticRef('cursor', `diagnostic-raw-cap-${index}`);
    }
    const secondRawRef = diagnosticRef('cursor', rawAnchor);
    expect(secondRawRef).not.toBe(firstRawRef);
    expect(Number(secondRawRef.split('-').at(-1))).toBeGreaterThan(Number(firstRawRef.split('-').at(-1)));

    const events = captureEvents();
    const issuedAnchor = diagnosticRef('user', 'diagnostic-issued-cap-anchor');
    for (let index = 0; index < 8_193; index += 1) {
      diagnosticRef('user', `diagnostic-issued-cap-${index}`);
    }
    beginDiagnosticTrace('user', 'load', { userRef: issuedAnchor });
    expect(events().at(-1)).toEqual(expect.objectContaining({ userRef: 'redacted' }));
  });

  it('links optimized and original media aliases to one process-local reference', () => {
    const displayUrl = 'https://img.example.com/diagnostic-display-640.webp';
    const originalUrl = 'https://img.example.com/diagnostic-original.png';
    const bodyRef = diagnosticRef('media', displayUrl);

    linkDiagnosticRefs('media', [displayUrl, originalUrl]);

    expect(diagnosticRef('media', originalUrl)).toBe(bodyRef);
  });

  it('normalizes failures without reading arbitrary object properties', () => {
    expect(normalizeDiagnosticReason(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe('canceled');
    expect(normalizeDiagnosticReason(new Error('request timeout'))).toBe('timeout');
    expect(normalizeDiagnosticReason(new Error('HTTP 403 forbidden'))).toBe('permission_denied');
    expect(normalizeDiagnosticReason(new Error('HTTP status 500'))).toBe('http_error');
    expect(normalizeDiagnosticReason(new Error('Google 搜索环境验证暂时未通过，请稍后重试'))).toBe(
      'verification_required'
    );
    expect(normalizeDiagnosticReason(new SyntaxError('Unexpected token in JSON'))).toBe('invalid_response');
    expect(normalizeDiagnosticReason(new TypeError('Network request failed'))).toBe('network_error');
    expect(
      normalizeDiagnosticReason({
        message: 'token=ULTRA_FAKE_SECRET_9',
        toString: () => {
          throw new Error('must not stringify');
        }
      })
    ).toBe('unknown');
  });

  it('normalizes recognizable business failure classes', () => {
    expect(normalizeDiagnosticReason(new Error('storage write failed'))).toBe('storage_error');
    expect(normalizeDiagnosticReason(new Error('missing credential'))).toBe('missing_credential');
    expect(normalizeDiagnosticReason(new Error('parsed result is empty'))).toBe('parse_empty');
    expect(normalizeDiagnosticReason(new Error('operation already in progress'))).toBe('busy');
    expect(normalizeDiagnosticReason(new Error('duplicate request'))).toBe('duplicate');
    expect(normalizeDiagnosticReason(new Error('feature not supported'))).toBe('unsupported');
    expect(normalizeDiagnosticReason(new Error('share is not available'))).toBe('share_unavailable');
    expect(normalizeDiagnosticReason(new Error('refresh failed'))).toBe('refresh_failed');
    expect(normalizeDiagnosticReason(new Error('备份文件过大'))).toBe('invalid_response');
    expect(normalizeDiagnosticReason(new Error('备份格式不兼容'))).toBe('invalid_response');
    expect(normalizeDiagnosticReason(new Error('备份文件大小无法确认'))).toBe('storage_error');
  });

  it('redacts and bounds uncaught error details', () => {
    const events = captureEvents();
    const error = new Error(
      'PRIVATE_TITLE_91827 PRIVATE_BODY_91827 Failed https://linux.do/users/private?token=ULTRA_FAKE_SECRET_9 password=ULTRA_FAKE_SECRET_9 C:\\Users\\alice\\private.txt'
    );
    error.stack = `${error.message}\n    at privateFn (C:\\Users\\alice\\project\\private.ts:1:2)\n${'x'.repeat(5_000)}`;

    recordDiagnosticError('app', 'uncaught-error', error);

    const event = events()[0];
    expect(event).toEqual(expect.objectContaining({ phase: 'finish', outcome: 'failure', errorName: 'Error' }));
    expect(event.message).toBe('unknown');
    expect(event.stack).toBe('Error\n    at [frame] ([bundle]:1:2)');
    expect(String(event.message).length).toBeLessThanOrEqual(512);
    expect(String(event.stack).length).toBeLessThanOrEqual(2_048);
    expect(JSON.stringify(event)).not.toMatch(
      /PRIVATE_TITLE_91827|PRIVATE_BODY_91827|ULTRA_FAKE_SECRET_9|linux\.do|users|private\.txt|private\.ts|C:\\\\Users/
    );
  });

  it('never lets synchronous or asynchronous writer failures escape', async () => {
    setDiagnosticWriter(() => {
      throw new Error('disk failed');
    });
    expect(() => beginDiagnosticTrace('diagnostic', 'sync-writer-failure')).not.toThrow();

    setDiagnosticWriter(async () => {
      throw new Error('async disk failed');
    });
    expect(() => beginDiagnosticTrace('diagnostic', 'async-writer-failure')).not.toThrow();
    await Promise.resolve();
  });
});
