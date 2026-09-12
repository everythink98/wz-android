import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import {
  beginDiagnosticTrace,
  diagnosticRequestContext,
  diagnosticRequestFields,
  diagnosticTraceForRequest,
  finishDiagnosticTrace,
  hintDiagnosticOutcome,
  markDiagnosticStage,
  recordDiagnosticError,
  setDiagnosticWriter,
  withDiagnosticFetcher,
  withNativeDiagnosticRequest
} from './diagnostics';
import {
  type DiagnosticFields,
  diagnosticRef,
  linkDiagnosticRefs,
  normalizeDiagnosticReason,
  safeDiagnosticOperation,
  safeFields,
  type DiagnosticOperation
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
  it('keeps production operations, stages and typed reasons after sanitization', () => {
    expectTypeOf<string>().not.toExtend<DiagnosticOperation>();
    expectTypeOf<string>().not.toExtend<DiagnosticFields['state']>();
    expectTypeOf<string>().not.toExtend<DiagnosticFields['reason']>();
    const operations = [
      'install',
      'prefetch-post',
      'migrate-cookie-snapshots',
      'stardust-payment',
      'load-templates',
      'manage-poll'
    ] as const satisfies readonly DiagnosticOperation[];
    expect(operations.map(safeDiagnosticOperation)).toEqual(operations);
    const fields = {
      state: 'published',
      credentialSource: 'managed-cookie-jar',
      emptyReason: 'route-owned',
      hasResult: true,
      count: 2,
      reason: 'identity_pending'
    } as const satisfies DiagnosticFields;
    expect(safeFields(fields)).toEqual(fields);
    expect(normalizeDiagnosticReason({ reason: 'identity-pending' })).toBe('identity_pending');
    expect(normalizeDiagnosticReason({ reason: 'object-forbidden' })).toBe('object_forbidden');
    expect(normalizeDiagnosticReason({ reason: 'source-disabled' })).toBe('source_disabled');
    expect(normalizeDiagnosticReason({ reason: 'account-recheck-required' })).toBe('login_required');
    expect(safeFields({ privateCount: 3, reason: 'private-reason' })).toEqual({ reason: 'unknown' });
  });

  it('preserves Hermes bytecode coordinates while excluding internal frames and private text', () => {
    const events = captureEvents();
    const error = new Error('private message');
    error.stack =
      'Error: private message\n    at privateName (address at index.android.bundle:1:1048576)\n    at internal (address at InternalBytecode.js:1:640)\n    at other (private/path.js:2:15)\n    at apply (native)';
    recordDiagnosticError('app', 'js-error', error, { isFatal: true });
    expect(events()[0]).toMatchObject({
      isFatal: true,
      stackFormat: 'hermes',
      stack: 'Error\n    at [frame] (address at [bundle]:1:1048576)\n    at [frame] ([bundle]:2:15)\n    at [frame]'
    });
    expect(JSON.stringify(events())).not.toMatch(/private|InternalBytecode|640/);
  });

  it('retains only closed exception classifications and reading durations', () => {
    const events = captureEvents();
    const fixtures = [
      ['fetch failed: PRIVATE_URL', undefined, 'fetch-wrapper'],
      ['PRIVATE_URL', 'ERR_FETCH_REQUEST_CANCELED', 'fetch-request-canceled'],
      [
        "Call to function 'NativeRequest.cancel' has been rejected. PRIVATE_URL",
        'ERR_FUNCTION_CALL',
        'fetch-request-cancel'
      ],
      [
        "Call to function 'NativeResponse.cancelStreaming' has been rejected. PRIVATE_URL",
        'ERR_FUNCTION_CALL',
        'fetch-stream-cancel'
      ],
      ['PRIVATE_URL', 'ERR_UNEXPECTED', 'native-unexpected'],
      [
        "Call to function 'a.b.cancelSelection' has been rejected.\n→ Caused by: Unable to find the class a.b view with tag 123",
        'ERR_L',
        'selection-view-missing'
      ],
      ["Call to function 'a.b.cancelSelection' has been rejected. PRIVATE_URL", 'ERR_X', 'selection-cancel'],
      ["Call to function 'PRIVATE_MODULE.cancel' has been rejected.", 'ERR_FUNCTION_CALL', 'native-function'],
      ['canceled PRIVATE_URL', 'PRIVATE_CODE', 'unknown']
    ] as const;
    for (const [message, code] of fixtures) {
      recordDiagnosticError('app', 'unhandled-rejection', Object.assign(new Error(message), { code }));
    }
    expect(events().map((event) => event.exceptionKind)).toEqual(fixtures.map((fixture) => fixture[2]));
    expect(JSON.stringify(events())).not.toMatch(/PRIVATE_|ERR_|NativeRequest|NativeResponse|fetch failed/);
    expect(JSON.stringify(events())).not.toMatch(/a\.b|view with tag|cancelSelection/);
    expect(safeFields({ topicTimeMs: 1200, postTimeMs: 1000, exceptionKind: 'PRIVATE_KIND' })).toEqual({
      topicTimeMs: 1200,
      postTimeMs: 1000,
      exceptionKind: 'redacted'
    });
  });

  it('correlates concurrent copied request options without mutating the caller', async () => {
    const events = captureEvents();
    const trace = beginDiagnosticTrace('topic', 'open');
    const original = Object.freeze({ method: 'GET', headers: Object.freeze({ Accept: 'application/json' }) });
    const contexts: { requestId?: string; headers: Headers }[] = [];
    const copies: RequestInit[] = [];
    const fetcher = withDiagnosticFetcher(trace, async (_input, init) => {
      const copied = { ...init, signal: new AbortController().signal };
      copies.push(copied);
      const native = withNativeDiagnosticRequest(copied);
      contexts.push({ ...diagnosticRequestFields(copied), headers: new Headers(native?.headers) });
      expect(diagnosticTraceForRequest(copied)).toBe(trace);
      await Promise.resolve();
      return new Response('ok');
    });
    await Promise.all([fetcher('https://linux.do/t/1.json', original), fetcher('https://linux.do/t/2.json', original)]);
    expect(contexts[0].requestId).not.toBe(contexts[1].requestId);
    for (const context of contexts) {
      expect(context.headers.get('X-WZ-Diagnostic-Request')).toBe(context.requestId);
      expect(context.headers.get('X-WZ-Diagnostic-Trace')).toBe(trace.traceId);
      expect(context.headers.get('X-WZ-Diagnostic-Session')).toBe(trace.appSessionId);
      expect(
        events()
          .filter((event) => event.requestId === context.requestId)
          .map((event) => event.state)
      ).toEqual(['start', 'finish']);
    }
    expect(copies.every((copy) => diagnosticRequestContext(copy) === undefined)).toBe(true);
    expect(original).toEqual({ method: 'GET', headers: { Accept: 'application/json' } });
  });

  it('allowlists only aggregate topic body media counters', () => {
    const events = captureEvents();
    const trace = beginDiagnosticTrace('media', 'topic-body-media', {
      source: 'nodeseek',
      topicRef: diagnosticRef('topic', 'nodeseek:863650')
    });

    finishDiagnosticTrace(trace, 'success', {
      catalogReadyElapsedMs: 120,
      firstMediaElapsedMs: 180,
      firstRowElapsedMs: 250,
      plannedRowCount: 500,
      networkMediaCount: 2000,
      warmHighWater: 8,
      runningHighWater: 4,
      timerHighWater: 1,
      timeoutCount: 2,
      cancelCount: 3,
      errorCount: 4,
      displayCount: 5,
      retryCount: 1,
      requestIdentity: 'https://secret.example/image.jpg?token=private'
    } as never);

    expect(events()).toEqual([
      expect.objectContaining({ operation: 'topic-body-media', phase: 'intent' }),
      expect.objectContaining({
        operation: 'topic-body-media',
        phase: 'finish',
        catalogReadyElapsedMs: 120,
        firstMediaElapsedMs: 180,
        firstRowElapsedMs: 250,
        plannedRowCount: 500,
        networkMediaCount: 2000,
        warmHighWater: 8,
        runningHighWater: 4,
        timerHighWater: 1,
        timeoutCount: 2,
        cancelCount: 3,
        errorCount: 4,
        displayCount: 5,
        retryCount: 1
      })
    ]);
    expect(JSON.stringify(events())).not.toContain('secret.example');
  });

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

  it('records only sanitized NodeImage authorization stages', () => {
    const events = captureEvents();
    const trace = beginDiagnosticTrace('credential', 'auth', {
      credentialSource: 'nodeimage',
      nonce: 'nonce-secret',
      state: 'session-check'
    } as unknown as DiagnosticFields);

    for (const state of ['session-expired', 'connect-started', 'connect-finished', 'key-saved']) {
      markDiagnosticStage(trace, 'credential', {
        apiKey: 'api-key-secret',
        payload: 'payload-secret',
        state
      } as unknown as DiagnosticFields);
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

  it('records only the classified NodeImage timeout result', () => {
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
    } as unknown as DiagnosticFields);
    finishDiagnosticTrace(trace, 'failure', {
      documentUrl: 'https://www.nodeimage.com/?secret=1',
      reason: 'timeout'
    } as unknown as DiagnosticFields);

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

  it('adds only process-local context when the caller omits request options', async () => {
    const trace = beginDiagnosticTrace('media', 'save-image');
    let receivedInit: RequestInit | undefined = { method: 'POST' };
    const fetcher = withDiagnosticFetcher(trace, async (_input, init) => {
      receivedInit = init;
      return new Response('ok');
    });

    await fetcher('https://example.com/image.jpg');

    expect(Object.keys(receivedInit || {})).toEqual([]);
    expect(diagnosticRequestContext(receivedInit)).toBeUndefined();
  });

  it('keeps media diagnostics categorical and drops URLs', () => {
    const events = captureEvents();
    const trace = beginDiagnosticTrace('media', 'load', {
      source: 'linuxdo',
      surface: 'preview',
      mediaClass: 'cross-source',
      url: 'https://secret.example/private.png?token=secret'
    } as unknown as DiagnosticFields);
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
    const fetcher = withDiagnosticFetcher(trace, async (_input, receivedInit) => {
      nestedInit = receivedInit;
      nestedTrace = diagnosticTraceForRequest(receivedInit);
      return new Response('ok');
    });

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

  it.each(['html-topic', 'html-topic-fallback', 'api-topic-fallback'] as const)(
    'keeps the allowlisted parser variant %s',
    (parserVariant) => {
      const events = captureEvents();
      const trace = beginDiagnosticTrace('topic', 'parse-topic');

      markDiagnosticStage(trace, 'parse', { parserVariant });

      expect(events().at(-1)).toEqual(expect.objectContaining({ parserVariant }));
    }
  );

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

    beginDiagnosticTrace(
      'source',
      safeDiagnosticOperation('/users/private?token=ULTRA_FAKE_SECRET_9'),
      unsafeFields,
      1_000
    );

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

    beginDiagnosticTrace('search', safeDiagnosticOperation('PRIVATE_OPERATION_91827'));
    for (const key of Object.keys(fallbackByField)) {
      beginDiagnosticTrace('search', 'request', {
        [key]: key === 'route' ? 'codex' : `PRIVATE_${key}_91827`
      } as unknown as DiagnosticFields);
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
    } as unknown as DiagnosticFields);

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

  it('bounds raw and issued diagnostic references without reusing IDs', () => {
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
    expect(normalizeDiagnosticReason(Object.assign(new Error('搜索结果缺少标题'), { reason: 'parse_empty' }))).toBe(
      'parse_empty'
    );
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
    expect(() => beginDiagnosticTrace('diagnostic', 'request')).not.toThrow();

    setDiagnosticWriter(async () => {
      throw new Error('async disk failed');
    });
    expect(() => beginDiagnosticTrace('diagnostic', 'request')).not.toThrow();
    await Promise.resolve();
  });
});
