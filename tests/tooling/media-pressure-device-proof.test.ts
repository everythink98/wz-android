// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAgentDevice } from '../../scripts/agent-device-runtime.mjs';
import { waitForMediaProofChange } from '../../dev/media-pressure-proof/wait-for-change';
import {
  assertMediaPressureAvd,
  assertMediaPressureReceipt,
  driveMediaFullscreen,
  mediaPressureIdentity
} from '../../scripts/run-media-pressure-device-proof.mjs';

const expected = { token: 'fixture-token', buildId: 'a'.repeat(32), versionCode: 7 };
const complete = () => ({
  ...expected,
  processSessionId: `process-${'b'.repeat(32)}`,
  isDev: false,
  isHermes: true,
  rounds: 20,
  minSeconds: 180,
  externalEvery: 5,
  errors: [],
  phase: 'passed',
  completedRounds: 20,
  elapsedMs: 180_100,
  roundResults: Array.from({ length: 20 }, (_, index) => ({
    index,
    created: (index + 1) * 3,
    released: (index + 1) * 3,
    fullscreenRetention:
      index % 5 === 0 || index === 19
        ? {
            serial: index + 1,
            retainedMs: 750,
            startPosition: 3,
            startedPlaying: true,
            endPosition: 4,
            endedPlaying: false
          }
        : undefined
  })),
  created: 60,
  released: 60,
  peakPlayers: 2,
  livePlayers: 0,
  players: [],
  observerSubscriptions: 0,
  fullscreenEntries: 5,
  fullscreenExits: 5,
  backgroundEntries: 5,
  foregroundReturns: 5
});

const fullscreenButton = (label = 'Enter fullscreen', y = 1084) => ({
  identifier: 'com.wz.reader:id/exo_fullscreen',
  label,
  enabled: true,
  visibleToUser: true,
  hittable: true,
  rect: { x: 823, y, width: 126, height: 126 }
});
const enteringFullscreen = () => ({
  token: 'current-proof',
  phase: 'await-fullscreen-enter',
  fullscreenEntries: 0,
  fullscreenExits: 0
});
const retainedFullscreen = (receipt: ReturnType<typeof enteringFullscreen>) => ({
  ...receipt,
  phase: 'await-fullscreen-exit',
  inlineVideoMounted: false,
  fullscreenRetention: { serial: 3, committedAt: 1000 },
  players: [{ serial: 3, fullscreen: true, fullscreenActive: true, detachedAt: 990 }]
});

it('immediately taps the observed native fullscreen rectangle and requires its enter receipt', async () => {
  const receipt = enteringFullscreen();
  let current: ReturnType<typeof enteringFullscreen> | ReturnType<typeof retainedFullscreen> = receipt;
  const events: string[] = [];
  const snapshot = vi.fn(() => {
    events.push('snapshot');
    return [fullscreenButton()];
  });
  const tap = vi.fn(() => {
    events.push('tap');
    current = retainedFullscreen({ ...receipt, fullscreenEntries: 1 });
  });
  await driveMediaFullscreen({ receipt, snapshot, tap, readReceipt: () => current, wait: async () => {} });
  expect(events).toEqual(['snapshot', 'tap']);
  expect(tap).toHaveBeenCalledExactlyOnceWith(886, 1147, fullscreenButton());
});

it('recovers one missed fullscreen click by revealing actual controls and taking a fresh rectangle', async () => {
  const receipt = enteringFullscreen();
  let current: ReturnType<typeof enteringFullscreen> | ReturnType<typeof retainedFullscreen> = receipt;
  const frame = {
    identifier: 'com.wz.reader:id/texture_player_view',
    enabled: true,
    visibleToUser: true,
    rect: { x: 33, y: 709, width: 921, height: 517 }
  };
  const snapshot = vi
    .fn()
    .mockReturnValueOnce([fullscreenButton()])
    .mockReturnValueOnce([frame])
    .mockReturnValueOnce([fullscreenButton('Enter fullscreen', 1000)]);
  const tap = vi.fn((_x: number, y: number) => {
    if (y === 1063) current = retainedFullscreen({ ...receipt, fullscreenEntries: 1 });
  });
  await driveMediaFullscreen({ receipt, snapshot, tap, readReceipt: () => current, wait: async () => {} });
  expect(snapshot.mock.calls.map(([name]) => name)).toEqual(['attempt-1', 'attempt-2', 'attempt-2-revealed']);
  expect(tap.mock.calls.map(([x, y]) => [x, y])).toEqual([
    [886, 1147],
    [494, 968],
    [886, 1063]
  ]);
});

it('requires the exit event for exiting and never retries beyond two observed button clicks', async () => {
  const receipt = retainedFullscreen({ ...enteringFullscreen(), fullscreenEntries: 1 });
  let current = receipt;
  const observations: string[] = [];
  const tap = vi.fn(() => {
    observations.push('tap');
    current = { ...receipt, phase: 'fullscreen-exited', fullscreenExits: 1 };
  });
  const wait = vi.fn(async (ms: number) => {
    observations.push(`wait:${ms}`);
  });
  await driveMediaFullscreen({
    receipt,
    snapshot: () => [fullscreenButton('Exit fullscreen')],
    tap,
    readReceipt: () => current,
    screenshot: (name: string) => observations.push(name),
    wait
  });
  expect(tap).toHaveBeenCalledTimes(1);
  expect(wait).toHaveBeenNthCalledWith(1, 750);
  expect(observations.slice(0, 4)).toEqual(['fullscreen-hold-start', 'wait:750', 'fullscreen-hold-end', 'tap']);

  tap.mockClear();
  await expect(
    driveMediaFullscreen({
      receipt,
      snapshot: () => [fullscreenButton('Enter fullscreen')],
      tap,
      readReceipt: () => receipt,
      wait: async () => {}
    })
  ).rejects.toThrow('exit button');
  expect(tap).not.toHaveBeenCalled();
  await expect(
    driveMediaFullscreen({
      receipt,
      snapshot: () => [fullscreenButton('Exit fullscreen')],
      tap,
      readReceipt: () => ({ ...receipt, fullscreenEntries: 2 }),
      wait: async () => {}
    })
  ).rejects.toThrow('after two');
  expect(tap).toHaveBeenCalledTimes(2);
});

it('requires committed inline removal and retained native ownership before allowing fullscreen exit', async () => {
  const receipt = retainedFullscreen({ ...enteringFullscreen(), fullscreenEntries: 1 });
  const tap = vi.fn();
  for (const current of [
    { ...receipt, inlineVideoMounted: true },
    { ...receipt, players: [] },
    { ...receipt, players: [{ ...receipt.players[0], fullscreenActive: false }] }
  ]) {
    await expect(
      driveMediaFullscreen({
        receipt,
        snapshot: () => [fullscreenButton('Exit fullscreen')],
        tap,
        readReceipt: () => current,
        wait: async () => {}
      })
    ).rejects.toThrow('retention lost');
  }
  expect(tap).not.toHaveBeenCalled();
  const completed = complete();
  completed.roundResults[0].fullscreenRetention!.retainedMs = 599;
  expect(() => assertMediaPressureReceipt(completed, expected, true)).toThrow('600ms');
  for (const mutation of [
    { startedPlaying: false },
    { startPosition: NaN },
    { endPosition: NaN },
    { endPosition: 3.2 }
  ]) {
    const stalled = complete();
    Object.assign(stalled.roundResults[0].fullscreenRetention!, mutation);
    expect(() => assertMediaPressureReceipt(stalled, expected, true)).toThrow('native playback position');
  }
});

it('wakes and clears its polling timer from an event when Android JS timers never advance', async () => {
  vi.useFakeTimers();
  const changes = new Set<() => void>();
  try {
    const pending = waitForMediaProofChange(changes);
    expect(changes.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    for (const notify of changes) notify();
    await pending;
    expect(changes.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const foreground = waitForMediaProofChange(changes);
    await vi.advanceTimersByTimeAsync(100);
    await foreground;
    expect(changes.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('never invents a fullscreen tap when no visible native target was observed', async () => {
  const receipt = enteringFullscreen();
  const tap = vi.fn();
  await expect(
    driveMediaFullscreen({
      receipt,
      snapshot: () => [{ ...fullscreenButton(), visibleToUser: false }],
      tap,
      readReceipt: () => receipt,
      wait: async () => {}
    })
  ).rejects.toThrow('No visible');
  expect(tap).not.toHaveBeenCalled();
});

it('restricts driving to the dedicated AVD and a complete installed APK identity', () => {
  expect(() => assertMediaPressureAvd('WZ_ImageRuntime_Test_API35')).not.toThrow();
  expect(() => assertMediaPressureAvd('WZ_ImageRuntime_Test_API35\r\r\nOK\r\r\n')).not.toThrow();
  expect(() => assertMediaPressureAvd('WZ_ReaderStorage_Test_API35')).toThrow('Refusing');
  const dump =
    '  userId=10234\n  versionCode=7 minSdk=24\n  firstInstallTime=2026-09-22 18:00:00\n  User 0: installed=true hidden=false';
  const apk = '/data/app/~~proof/com.wz.reader-proof/base.apk';
  expect(mediaPressureIdentity(dump, apk, 'c'.repeat(64))).toEqual({
    uid: '10234',
    firstInstallTime: '2026-09-22 18:00:00',
    versionCode: 7,
    apkPath: apk,
    apkHash: 'c'.repeat(64)
  });
  expect(mediaPressureIdentity(dump.replace('userId=', 'appId='), apk, 'c'.repeat(64)).uid).toBe('10234');
  expect(() => mediaPressureIdentity(dump.replace('installed=true', 'installed=false'), apk, 'c'.repeat(64))).toThrow(
    'user 0'
  );
  expect(() => mediaPressureIdentity(dump, '', 'c'.repeat(64))).toThrow('base.apk');
  expect(() => mediaPressureIdentity(dump, apk, '')).toThrow('hash');
});

it('requires the same release process and settled real playback/fullscreen/background rounds', () => {
  expect(() => assertMediaPressureReceipt(complete(), expected, true)).not.toThrow();
  for (const changed of [
    { token: 'stale-token' },
    { buildId: 'd'.repeat(32) },
    { versionCode: 8 },
    { isDev: true },
    { isHermes: false },
    { rounds: 19 },
    { minSeconds: 1 },
    { phase: 'failed' },
    { phase: 'await-fullscreen-exit' },
    { errors: ['decoder failed'] },
    { completedRounds: 19 },
    { elapsedMs: 179_999 },
    { roundResults: [] },
    { released: 59 },
    { livePlayers: 1 },
    { players: [{}] },
    { observerSubscriptions: 1 },
    { peakPlayers: 3 },
    { fullscreenEntries: 4 },
    { fullscreenExits: 4 },
    { backgroundEntries: 4 },
    { foregroundReturns: 4 }
  ])
    expect(() => assertMediaPressureReceipt({ ...complete(), ...changed }, expected, true)).toThrow();
  expect(() =>
    assertMediaPressureReceipt(complete(), { ...expected, processSessionId: `process-${'f'.repeat(32)}` }, true)
  ).toThrow('restarted');
  const late = complete();
  late.completedRounds = 21;
  late.created = late.released = 63;
  late.roundResults.push({
    index: 20,
    created: 63,
    released: 63,
    fullscreenRetention: {
      serial: 21,
      retainedMs: 750,
      startPosition: 3,
      startedPlaying: true,
      endPosition: 4,
      endedPlaying: false
    }
  });
  expect(() => assertMediaPressureReceipt(late, expected, true)).toThrow('transitions');
  expect(() =>
    assertMediaPressureReceipt(
      { ...late, fullscreenEntries: 6, fullscreenExits: 6, backgroundEntries: 6, foregroundReturns: 6 },
      expected,
      true
    )
  ).not.toThrow();
});

it.runIf(process.platform === 'win32')('bounds a stalled local agent CLI without contacting a device', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'media-proof-timeout-'));
  const originalPath = process.env.PATH;
  try {
    const bin = path.join(directory, 'node_modules/agent-device/bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(directory, 'agent-device.ps1'), "throw 'Must use local Node fixture'");
    writeFileSync(path.join(bin, 'agent-device.mjs'), 'setInterval(() => {}, 1000);');
    process.env.PATH = directory;
    expect(() => runAgentDevice([], { capture: true, echoCapture: false, timeout: 200 })).toThrow('ETIMEDOUT');
  } finally {
    process.env.PATH = originalPath;
    expect(path.dirname(path.resolve(directory))).toBe(path.resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  }
});
