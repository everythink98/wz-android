// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import {
  backgroundCycleReceipt,
  backgroundJobRegistration,
  backgroundProofLimits,
  initializeBackgroundProofEpoch,
  nativeCompletion,
  verifyJobHistory
} from '../../scripts/run-notification-background-device-proof.mjs';

async function runBackgroundFixture({
  body,
  stage = 'grant',
  observation,
  unregister,
  stop,
  permission,
  report
}: {
  body: { error: unknown };
  stage?: 'grant' | 'ready';
  observation?: { error: unknown };
  unregister?: { error: unknown };
  stop?: { error: unknown };
  permission?: { error: unknown };
  report?: { error: unknown };
}) {
  const operations: string[] = [];
  const reports: { passed: boolean; restoration?: { phase: string }; causes?: string[] }[] = [];
  let grants = 0;
  let stops = 0;
  let cleanups = 0;
  let token = '';
  const finalStop = stage === 'grant' ? 1 : 4;
  const device = {
    avd: 'WZ_ReaderStorage_API35_20260910',
    package: 'com.wz.reader',
    identity: () => ({}),
    stop: () => {
      operations.push('stop');
      if (++stops === finalStop && stop) throw stop.error;
    },
    adb: (...args: string[]) => {
      const operation = args.join(' ');
      operations.push(operation);
      if (operation === 'shell dumpsys package com.wz.reader')
        return 'android.permission.POST_NOTIFICATIONS: granted=true';
      if (operation === 'shell pm grant com.wz.reader android.permission.POST_NOTIFICATIONS') {
        grants++;
        if (grants === 1 && stage === 'grant') throw body.error;
        if (grants === 2 && permission) throw permission.error;
        return '';
      }
      if (operation.startsWith('shell am start ')) {
        const url = new URL(args.at(-1)!);
        token = url.pathname.split('/').at(-1)!;
        if (url.hostname === 'background' && url.pathname.startsWith('/success/')) throw body.error;
        if (++cleanups > 1 && unregister) throw unregister.error;
        return '';
      }
      if (operation === 'shell run-as com.wz.reader cat cache/background-proof.json')
        return JSON.stringify({ token, checkpoint: 'cleaned' });
      if (operation === 'shell pidof com.wz.reader') return '';
      if (operation === 'shell date +%s%3N') {
        if (observation && (stage === 'grant' || cleanups > 0)) throw observation.error;
        return '1000000';
      }
      if (operation === 'shell cat /proc/uptime') return '1000.0';
      if (operation === 'shell dumpsys jobscheduler') return '';
      throw new Error('Unexpected synthetic command: ' + operation);
    }
  };
  vi.resetModules();
  vi.doMock('node:util', async (actual) => ({
    ...(await actual<typeof import('node:util')>()),
    parseArgs: () => ({
      values: { serial: 'emulator-fixture', output: '.codex-tmp/background-canonical.json', mode: 'success' },
      positionals: []
    })
  }));
  vi.doMock('node:fs', () => ({
    existsSync: () => false,
    mkdirSync: () => {},
    writeFileSync: (file: string, value: string) => {
      if (!file.endsWith('.json')) return;
      if (report) throw report.error;
      reports.push(JSON.parse(value));
    }
  }));
  vi.doMock('../../scripts/review-proof-checkpoint.mjs', () => ({
    proofDeviceForSerial: () => device,
    withProofCheckpoint: async ({ run }: { run: () => Promise<unknown> }) => {
      try {
        return { result: await run(), checkpoint: { phase: 'restored' } };
      } catch (error) {
        // Preserve the actual checkpoint wrapper's primitive-cause and restored receipt contract.
        const failure = error instanceof Error ? error : new Error('Device proof failed', { cause: error });
        try {
          Object.assign(failure, { checkpoint: { phase: 'restored' } });
        } catch {
          throw Object.assign(new Error(failure.message, { cause: error }), { checkpoint: { phase: 'restored' } });
        }
        throw failure;
      }
    }
  }));
  const argv = process.argv;
  let outcome: { kind: 'passed' } | { kind: 'failed'; error: unknown } = { kind: 'passed' };
  try {
    // Exercise the real CLI body without exporting or replacing its control flow.
    process.argv = [argv[0]!, path.resolve('scripts/run-notification-background-device-proof.mjs')];
    await import('../../scripts/run-notification-background-device-proof.mjs');
  } catch (error) {
    outcome = { kind: 'failed', error };
  } finally {
    process.argv = argv;
    vi.doUnmock('node:util');
    vi.doUnmock('node:fs');
    vi.doUnmock('../../scripts/review-proof-checkpoint.mjs');
    vi.resetModules();
  }
  return { outcome, operations, reports, grants };
}

describe('notification background runner cleanup', () => {
  it.each([undefined, null, false, 0, '', Symbol('failure'), 0n, Object.freeze({ code: 'failure' })])(
    'retains a %s primary cause through successful restoration',
    async (error) => {
      const result = await runBackgroundFixture({ body: { error } });
      expect(result.grants).toBe(2);
      expect(result.reports).toEqual([expect.objectContaining({ passed: false, restoration: { phase: 'restored' } })]);
      if (result.outcome.kind !== 'failed' || !(result.outcome.error instanceof Error))
        throw new Error('Expected the real checkpoint error contract');
      expect(result.outcome.error.cause).toBe(error);
    }
  );

  it('attempts permission restoration after stop fails and retains the falsy primary', async () => {
    const stop = new Error('Stop failed');
    const result = await runBackgroundFixture({ body: { error: 0 }, stop: { error: stop } });
    expect(result.grants).toBe(2);
    if (result.outcome.kind === 'failed') expect(result.outcome.error).toBeInstanceOf(AggregateError);
    if (result.outcome.kind !== 'failed' || !(result.outcome.error instanceof AggregateError))
      throw new Error('Expected both causes');
    expect(result.outcome.error.errors).toEqual([0, stop]);
  });

  it('retains the primary when evidence collection also fails', async () => {
    const body = new Error('Body failed');
    const observation = new Error('Job snapshot failed');
    const result = await runBackgroundFixture({ body: { error: body }, observation: { error: observation } });
    expect(result.grants).toBe(2);
    if (result.outcome.kind === 'failed') expect(result.outcome.error).toBeInstanceOf(AggregateError);
    if (result.outcome.kind !== 'failed' || !(result.outcome.error instanceof AggregateError))
      throw new Error('Expected body and evidence failure');
    expect(result.outcome.error.errors).toEqual([body, observation]);
  });

  it('attempts task cleanup, stop and permission restoration and retains every unknown cause', async () => {
    const result = await runBackgroundFixture({
      body: { error: false },
      stage: 'ready',
      unregister: { error: null },
      stop: { error: undefined },
      permission: { error: 0 }
    });
    expect(result.grants).toBe(2);
    expect(result.operations.filter((operation) => operation.startsWith('shell am start '))).toHaveLength(3);
    if (result.outcome.kind !== 'failed' || !(result.outcome.error instanceof AggregateError))
      throw new Error('Expected all causes');
    expect(result.outcome.error.errors).toEqual([false, null, undefined, 0]);
  });

  it('retains the original checkpoint failure when failure-report writing fails', async () => {
    const body = new Error('Body failed');
    const result = await runBackgroundFixture({ body: { error: body }, report: { error: false } });
    if (result.outcome.kind === 'failed') expect(result.outcome.error).toBeInstanceOf(AggregateError);
    if (result.outcome.kind !== 'failed' || !(result.outcome.error instanceof AggregateError))
      throw new Error('Expected original and report failure');
    expect(result.outcome.error.errors).toEqual([body, false]);
  });
});

describe('notification background device evidence', () => {
  it('accepts only a completed native worker handing off to a fresh fifteen-minute successor job', () => {
    const log = [
      '1790090107.661 6037 6071 D BackgroundTaskWork: doWork: Running worker',
      '1790090108.222 6037 6037 I TaskService: Started headless task 1 to keep JS timers alive',
      "1790090110.316 6037 6081 I TaskService: Finished task 'wz-isolated-headless-proof' with eventId 'proof'.",
      '1790090110.316 6037 6037 I TaskService: Finished headless task 1 for app',
      "1790090110.319 6037 6071 D BackgroundTaskScheduler: Enqueuing worker with identifier EXPO_BACKGROUND_WORKER and '15' minutes delay.",
      '1790090110.328 6037 6059 I WM-WorkerWrapper: Worker result SUCCESS for Work [ id=354a48f1-8cc3-4846-998e-976f39a15572, tags={ expo.modules.backgroundtask.BackgroundTaskWork } ]',
      '1790090110.328 6037 6059 I WM-WorkerWrapper: Setting status to enqueued for b695bf72-f136-4b47-9f24-696a50f74253'
    ].join('\n');
    const done = { startedAt: 1790090109765, finishedAt: 1790090110315, elapsedMs: 548 };
    const registration = { deviceEpochMs: 1790088984843, earliestEpochMs: 1790089884843 };
    const native = nativeCompletion(log, '6037', registration.deviceEpochMs, done)!;
    const service = 'com.wz.reader/androidx.work.impl.background.systemjob.SystemJobService';
    const snapshot = {
      deviceEpochMs: 1790090122740,
      deviceEpochAfterMs: 1790090122878,
      jobs: `  JOB #u0a209/26: next ${service}\n    Run time: earliest=+14m47s534ms, latest=none\nJob history:\n  -15s819ms START: #u0a209/25 ${service}\n  -15s429ms START: #u0a209/25 ${service}\n  -15s206ms STOP: #u0a209/25 ${service} cancelled while waiting for bind\n  -12s519ms STOP: #u0a209/25 ${service} canceled\nPending queue:`
    };
    expect(() => verifyJobHistory(snapshot, '25', registration, native, done, true)).not.toThrow();
    for (const jobs of [
      snapshot.jobs.replace('-12s519ms STOP', '-13s519ms STOP'),
      snapshot.jobs.replace('earliest=+14m47s534ms', 'earliest=+1m'),
      snapshot.jobs.replace('earliest=+14m47s534ms', 'earliest=+14m1s'),
      snapshot.jobs.replace('JOB #u0a209/26', 'JOB #u0a209/25'),
      snapshot.jobs.replace(' canceled\n', ' host crashed\n')
    ])
      expect(() => verifyJobHistory({ ...snapshot, jobs }, '25', registration, native, done, true)).toThrow();
    for (const removed of ['Enqueuing worker with identifier', 'Setting status to enqueued']) {
      const incomplete = nativeCompletion(
        log
          .split('\n')
          .filter((line) => !line.includes(removed))
          .join('\n'),
        '6037',
        registration.deviceEpochMs,
        done
      )!;
      expect(() => verifyJobHistory(snapshot, '25', registration, incomplete, done, true)).toThrow();
    }
  });
  it('cleans the named proof task before trusting an empty stopped-package JobScheduler snapshot', async () => {
    const operations: string[] = [];
    let persistedOldTask = true;
    await initializeBackgroundProofEpoch({
      cleanup: async () => {
        operations.push('cleanup');
        persistedOldTask = false;
      },
      snapshot: () => {
        operations.push('snapshot');
        // force-stop hides jobs while the persisted WorkManager task survives.
        return { jobs: '' };
      }
    });
    expect(persistedOldTask).toBe(false);
    expect(operations).toEqual(['cleanup', 'snapshot']);
    const staleJob = {
      jobs: '  JOB #u0a209/24: bf6a87d com.wz.reader/androidx.work.impl.background.systemjob.SystemJobService\n    Run time: earliest=none, latest=none, original latest=none\n',
      deviceEpochMs: 1790088725698,
      deviceEpochAfterMs: 1790088725970
    };
    expect(() => backgroundJobRegistration(staleJob)).toThrow(/fresh fifteen-minute/);
    await expect(initializeBackgroundProofEpoch({ cleanup: async () => {}, snapshot: () => staleJob })).rejects.toThrow(
      /remained/
    );
    let inspected = false;
    await expect(
      initializeBackgroundProofEpoch({
        cleanup: async () => {
          throw new Error('cleanup failed');
        },
        snapshot: () => {
          inspected = true;
          return { jobs: '' };
        }
      })
    ).rejects.toThrow('cleanup failed');
    expect(inspected).toBe(false);
  });
  it('bounds the entire observation and reserves real fifteen-minute natural cycles', () => {
    expect(backgroundProofLimits({ natural: true, cycles: '2', 'timeout-minutes': '50' })).toEqual({
      cycles: 2,
      timeoutMs: 3000000
    });
    expect(backgroundProofLimits({ natural: true })).toEqual({ cycles: 1, timeoutMs: 2700000 });
    for (const cycles of ['0', '9', '1.5', 'NaN']) expect(() => backgroundProofLimits({ cycles })).toThrow();
    for (const minutes of ['29', '181', 'NaN'])
      expect(() => backgroundProofLimits({ natural: true, cycles: '2', 'timeout-minutes': minutes })).toThrow();
  });

  it('waits for a new completed run and rejects skipped, failed or unversioned receipts', () => {
    const passed = { token: 'epoch', run: 1, checkpoint: 'passed' };
    expect(backgroundCycleReceipt(passed, 'epoch', 2)).toBeNull();
    expect(backgroundCycleReceipt({ ...passed, run: 2, checkpoint: 'running' }, 'epoch', 2)).toBeNull();
    const next = { ...passed, run: 2 };
    expect(backgroundCycleReceipt(next, 'epoch', 2)).toBe(next);
    expect(backgroundCycleReceipt(next, 'other-epoch', 2)).toBeNull();
    for (const patch of [{ run: 3 }, { run: undefined }, { run: 2, checkpoint: 'failed' }])
      expect(() => backgroundCycleReceipt({ ...passed, ...patch }, 'epoch', 2)).toThrow();
  });

  it('requires exactly one freshly rescheduled periodic job after each completion', () => {
    const jobs =
      '  JOB #u0a123/9: com.wz.reader/androidx.work.impl.background.systemjob.SystemJobService\n' +
      '    Run time: earliest=+14m59s999ms, latest=none\n';
    const snapshot = { jobs, deviceEpochMs: 1000000, deviceEpochAfterMs: 1000100 };
    expect(backgroundJobRegistration(snapshot)).toMatchObject({ jobId: '9', earliestEpochMs: 1899999 });
    for (const replacement of ['', jobs + jobs, jobs.replace('14m59s999ms', '1m'), jobs.replace('14m', '16m')])
      expect(() => backgroundJobRegistration({ ...snapshot, jobs: replacement })).toThrow();
  });

  it('isolates later cycles from prior native completions while preserving task and job ordering', () => {
    const cycle = (base: number, id: number) => [
      `${base}.100 123 456 D BackgroundTaskWork: doWork: Running worker`,
      `${base}.110 123 456 D TaskService: Started headless task ${id} with app id`,
      `${base}.710 123 456 D TaskService: Finished task 'wz-isolated-headless-proof' with eventId 'proof'`,
      `${base}.720 123 456 D TaskService: Finished headless task ${id} with app id`,
      `${base}.730 123 456 I WM-WorkerWrapper: Worker result SUCCESS for Work [ expo.modules.backgroundtask.BackgroundTaskWork ]`
    ];
    const log = [...cycle(1000, 1), ...cycle(1900, 2)].join('\n');
    const done = { startedAt: 1900200, finishedAt: 1900700, elapsedMs: 500 };
    const registration = { deviceEpochMs: 1001000, earliestEpochMs: 1900000 };
    const native = nativeCompletion(log, '123', registration.deviceEpochMs, done)!;
    expect(native.taskId).toBe('2');
    expect(() => nativeCompletion(log, '123', 999000, done)).toThrow(/Multiple native tasks/);
    const history = (start: string) => ({
      deviceEpochMs: 1901000,
      deviceEpochAfterMs: 1901010,
      jobs: `Job history:\n  -${start} START: #u0a123/9 com.wz.reader/androidx.work.impl.background.systemjob.SystemJobService\n  -200ms STOP: #u0a123/9 com.wz.reader/androidx.work.impl.background.systemjob.SystemJobService app called jobFinished\nPending queue:`
    });
    expect(verifyJobHistory(history('1s'), '9', registration, native, done, true).events).toHaveLength(2);
    expect(() => verifyJobHistory(history('2s'), '9', registration, native, done, true)).toThrow(
      /before its registered earliest/
    );
    expect(() => verifyJobHistory(history('100ms'), '9', registration, native, done, true)).toThrow();
    expect(() => nativeCompletion(log, '123', registration.deviceEpochMs, { ...done, finishedAt: 1900800 })).toThrow(
      /order/
    );
  });
});
