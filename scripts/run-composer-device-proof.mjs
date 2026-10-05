import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { runAgentDevice } from './agent-device-runtime.mjs';
import { buildDeviceProof } from './device-proof-build.mjs';
import {
  captureComposerExpressionGeometry,
  assertComposerExpressionGeometry,
  assertComposerExpressionInsets
} from './composer-expression-geometry.mjs';
import apkSigning from './apk-signing.cjs';

const root = path.resolve(import.meta.dirname, '..');
const pkg = 'com.wz.reader';
const allowedProofAvds = [
  'WZ_ComposerInsets_0916',
  'WZ_TopicCreation_Test_API35',
  'WZ_ComposerExpressions_Test_API35_20261005'
];
export function assertComposerProofAvd(avd) {
  if (!allowedProofAvds.includes(avd)) throw new Error(`Refusing non-proof device: ${avd}`);
}
export function composerImeStressLimits(values) {
  const cycles = Number(values['ime-cycles'] ?? 20);
  const chars = Number(values['ime-chars'] ?? 512);
  const minutes = Number(values['ime-timeout-minutes'] ?? 20);
  if (!Number.isInteger(cycles) || cycles < 1 || cycles > 100)
    throw new Error('--ime-cycles must be an integer between 1 and 100');
  if (!Number.isInteger(chars) || chars < 32 || chars > 4096)
    throw new Error('--ime-chars must be an integer between 32 and 4096');
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60)
    throw new Error('--ime-timeout-minutes must be an integer between 1 and 60');
  return { cycles, chars, timeoutMs: minutes * 60000 };
}
export function assertComposerImeEdit(before, after, input) {
  if (
    !input ||
    before.includes(input) ||
    after.length !== before.length + input.length ||
    !after.includes(input) ||
    after.replace(input, '') !== before
  )
    throw new Error('Native input did not preserve the complete WebView document exactly once');
}
export function composerImeInput(cycle, chars) {
  let input = '';
  for (let part = 0; input.length < chars; part += 1)
    input += `wz${String(cycle).padStart(3, '0')}p${String(part).padStart(3, '0')}${hash(`${cycle}:${part}`)}`.slice(
      0,
      64
    );
  return input.slice(0, chars);
}
export function injectComposerImeInput(adb, input) {
  const batches = [];
  // API 35 input text timestamps the entire generated KeyEvent[] once. A
  // single batch taking >10s expires in InputDispatcher; fresh commands renew
  // that timestamp without retrying input or changing the real keyboard.
  for (let offset = 0; offset < input.length; offset += 64) {
    const batch = input.slice(offset, offset + 64);
    const started = Date.now();
    adb('shell', 'input', 'text', batch);
    batches.push({ offset, chars: batch.length, elapsedMs: Date.now() - started });
  }
  return batches;
}
export function composerImeEditEvidence(before, after, input) {
  const occurrences = input ? after.split(input).length - 1 : 0;
  const retained = occurrences === 1 ? after.replace(input, '') : after;
  let prefix = 0;
  let suffix = 0;
  while (prefix < Math.min(before.length, retained.length) && before[prefix] === retained[prefix]) prefix += 1;
  while (
    suffix < Math.min(before.length, retained.length) - prefix &&
    before[before.length - suffix - 1] === retained[retained.length - suffix - 1]
  )
    suffix += 1;
  return {
    expectedChars: before.length + input.length,
    actualChars: after.length,
    inputOccurrences: occurrences,
    exactInsertion: occurrences === 1 && retained === before,
    comparison: 'Remove one full input match; repeated characters cannot identify which copy was lost',
    commonPrefix: prefix,
    unmatchedBefore: before.slice(prefix, before.length - suffix),
    unmatchedAfter: retained.slice(prefix, retained.length - suffix)
  };
}
export function assertComposerImeDom(value) {
  if (
    value.baseURI !== 'https://composer.local/' ||
    !value.editors?.some((editor) => /\b(?:ProseMirror|cm-content)\b/.test(editor.className))
  )
    throw new Error('DOM diagnostics target is not the initialized composer document');
}
// Serialized into the isolated proof WebView via CDP. Only observes DOM/events;
// never changes focus, selection, input, or the editor's private state.
export function captureComposerImeDom(document, phase) {
  const key = '__wzComposerImeObservation';
  const roots = () => [...document.querySelectorAll('.ProseMirror, .cm-content')];
  const selection = () => {
    const value = document.getSelection();
    const root = roots().find((node) => node.contains(value?.anchorNode) && node.contains(value?.focusNode));
    const offset = (node, position) => {
      if (!root || !node) return null;
      const range = document.createRange();
      range.selectNodeContents(root);
      range.setEnd(node, position);
      return range.toString().length;
    };
    return {
      root: root?.className ?? null,
      collapsed: value?.isCollapsed ?? null,
      anchor: offset(value?.anchorNode, value?.anchorOffset),
      focus: offset(value?.focusNode, value?.focusOffset),
      text: value?.toString() ?? '',
      activeElement: document.activeElement?.className ?? null
    };
  };
  const previous = document[key];
  if (previous && phase !== 'read')
    for (const type of previous.types) document.removeEventListener(type, previous.listener, true);
  if (phase === 'start') {
    const observation = {
      types: ['keydown', 'keyup', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend'],
      count: 0,
      counts: {},
      inputTypes: {},
      dataChars: {},
      printableKeyChars: {},
      anomalyCount: 0,
      anomalies: [],
      first: [],
      last: [],
      listener: undefined
    };
    observation.listener = (event) => {
      const target = event.target?.closest?.('.ProseMirror, .cm-content');
      if (!target) return;
      observation.count += 1;
      observation.counts[event.type] = (observation.counts[event.type] ?? 0) + 1;
      if (event.type === 'keydown' || event.type === 'keyup') {
        observation.printableKeyChars[event.type] =
          (observation.printableKeyChars[event.type] ?? 0) + (event.key?.length === 1 ? 1 : 0);
        return;
      }
      const inputType = `${event.type}:${event.inputType ?? ''}`;
      observation.inputTypes[inputType] = (observation.inputTypes[inputType] ?? 0) + 1;
      observation.dataChars[event.type] = (observation.dataChars[event.type] ?? 0) + (event.data?.length ?? 0);
      const entry = {
        at: Date.now(),
        type: event.type,
        inputType: event.inputType ?? null,
        composing: event.isComposing ?? null,
        data: event.data?.slice(0, 32) ?? null,
        dataChars: event.data?.length ?? 0,
        documentChars: target.textContent.length,
        targetRanges: [...(event.getTargetRanges?.() ?? [])].map((value) => {
          const range = document.createRange();
          range.setStart(value.startContainer, value.startOffset);
          range.setEnd(value.endContainer, value.endOffset);
          return { text: range.toString(), startOffset: value.startOffset, endOffset: value.endOffset };
        }),
        selection: selection()
      };
      if (
        entry.composing ||
        entry.inputType !== 'insertText' ||
        !entry.selection.collapsed ||
        entry.targetRanges.some((range) => range.text.length > 0)
      ) {
        observation.anomalyCount += 1;
        if (observation.anomalies.length < 16) observation.anomalies.push(entry);
      }
      if (observation.first.length < 16) observation.first.push(entry);
      else {
        observation.last.push(entry);
        if (observation.last.length > 16) observation.last.shift();
      }
    };
    document[key] = observation;
    for (const type of observation.types) document.addEventListener(type, observation.listener, true);
  } else if (phase === 'stop') delete document[key];
  return {
    at: Date.now(),
    url: document.URL,
    baseURI: document.baseURI,
    selection: selection(),
    // Source-mode DOM can be virtualized. The receipt remains the full-document oracle.
    editors: roots().map((node) => ({
      className: node.className,
      visible: node.getClientRects().length > 0,
      text: node.textContent,
      html: node.innerHTML
    })),
    events: previous
      ? {
          count: previous.count,
          counts: previous.counts,
          inputTypes: previous.inputTypes,
          dataChars: previous.dataChars,
          printableKeyChars: previous.printableKeyChars,
          anomalyCount: previous.anomalyCount,
          anomalies: previous.anomalies,
          first: previous.first,
          last: previous.last
        }
      : null
  };
}
async function connectComposerImeDom(adb) {
  const pid = adb('shell', 'pidof', pkg);
  if (!/^\d+$/.test(pid)) throw new Error('Expected one composer proof process for DOM diagnostics');
  const port = adb('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`);
  let socket;
  const close = () => {
    socket?.close();
    adb('forward', '--remove', `tcp:${port}`);
  };
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
    // loadDataWithBaseURL reports about:blank in DevTools. Verify the real
    // document baseURI and editor DOM before installing the observer below.
    const pages = (await response.json()).filter((page) => page.type === 'page');
    if (pages.length !== 1) throw new Error(`Expected one composer DOM target, found ${pages.length}`);
    socket = new WebSocket(pages[0].webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Composer DOM connection timed out')), 5000);
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error('Composer DOM connection failed'));
        },
        { once: true }
      );
    });
    let id = 0;
    const connection = {
      close,
      evaluate: (expression) =>
        new Promise((resolve, reject) => {
          const requestId = ++id;
          const finish = (error, value) => {
            clearTimeout(timer);
            socket.removeEventListener('message', listener);
            if (error) reject(error);
            else resolve(value);
          };
          const listener = (event) => {
            const message = JSON.parse(event.data);
            if (message.id !== requestId) return;
            if (message.error || message.result?.exceptionDetails)
              finish(new Error(`Composer DOM capture failed: ${JSON.stringify(message)}`));
            else finish(null, message.result.result.value);
          };
          const timer = setTimeout(() => finish(new Error('Composer DOM capture timed out')), 5000);
          socket.addEventListener('message', listener);
          socket.send(
            JSON.stringify({
              id: requestId,
              method: 'Runtime.evaluate',
              params: {
                expression,
                returnByValue: true
              }
            })
          );
        })
    };
    const capture = (phase) =>
      connection.evaluate(`(${captureComposerImeDom.toString()})(document, ${JSON.stringify(phase)})`);
    assertComposerImeDom(await capture('read'));
    return {
      ...connection,
      capture,
      expressions: () => connection.evaluate(`(${captureComposerExpressionGeometry.toString()})(document)`)
    };
  } catch (error) {
    close();
    throw error;
  }
}
export function recordComposerFailure({ result, error, persist, evidence }) {
  result.passed = false;
  result.error = error?.message || String(error);
  result.detail = error?.stderr || error?.stdout;
  persist();
  const failures = [];
  for (const [name, collect] of Object.entries(evidence)) {
    try {
      collect();
    } catch (failure) {
      failures.push(`${name}: ${failure?.message || String(failure)}`);
    }
  }
  if (failures.length) result.evidenceError = failures.join('\n');
  persist();
}
export function composerReplayArgs({ name, avd, submitLabel, launcher = '打开测试回复', close = '收起回复' }) {
  assertComposerProofAvd(avd);
  return [
    'replay',
    `dev/composer-proof/${name}.ad`,
    '-e',
    `SUBMIT_LABEL=${submitLabel}`,
    '-e',
    `LAUNCHER=${launcher}`,
    '-e',
    `CLOSE_LABEL=${close}`,
    '-e',
    `PROOF_DEVICE=${avd}`
  ];
}
export function isTopicCreationViewReady(nodes, source) {
  const native = JSON.stringify(nodes);
  return (
    native.includes(`Local ${source} topic proof`) &&
    nodes.some((node) => node.label === (source === 'yaohuo' ? '图片' : '发帖常用工具栏')) &&
    !/正在初始化编辑器|编辑器初始化中|正在恢复草稿|正在读取原站发帖规则/.test(native)
  );
}
export function isTopicCreationReceiptSettled(receipt, source, status) {
  const value = receipt.topic;
  const accepted = ['posted', 'enqueued'].includes(status);
  return (
    value?.writes > 0 &&
    value.attempts?.[source] === status &&
    (accepted ? value.route !== 'TopicComposer' : value.route === 'TopicComposer')
  );
}
const hash = (data) => createHash('sha256').update(data).digest('hex');
export const topicCreationCases = [
  ...['nodeseek', 'linuxdo', 'yaohuo'].flatMap((source) =>
    ['success', 'rejected', 'unconfirmed'].map((outcome) => ({
      id: `topic-${source}-${outcome}`,
      source,
      entry: 'topic',
      outcome
    }))
  ),
  { id: 'topic-linuxdo-enqueued', source: 'linuxdo', entry: 'topic', outcome: 'enqueued' },
  { id: 'topic-linuxdo-network-error', source: 'linuxdo', entry: 'topic', outcome: 'network-error' },
  { id: 'topic-inactive-receipt', source: 'nodeseek', entry: 'topic', outcome: 'success', stress: 'inactive-receipt' },
  ...['gift', 'poll', 'resources', 'files'].map((stress) => ({
    id: `topic-yaohuo-${stress}`,
    source: 'yaohuo',
    entry: 'topic',
    outcome: 'success',
    stress
  })),
  { id: 'topic-switch-drafts', source: 'nodeseek', entry: 'topic', stress: 'switch' },
  { id: 'topic-restart-drafts', source: 'yaohuo', entry: 'topic', stress: 'restart' },
  { id: 'topic-nodeseek-panel-keyboard', source: 'nodeseek', entry: 'topic', stress: 'panel-keyboard' },
  { id: 'topic-linuxdo-panel-keyboard', source: 'linuxdo', entry: 'topic', stress: 'panel-keyboard', dark: true }
];
export const composerCases = [
  ...['nodeseek', 'linuxdo'].map((source) => ({
    id: `expressions-${source}-large-font`,
    source,
    entry: 'reply',
    mode: 'rich',
    presentation: 'sheet',
    stress: 'expressions',
    keyboard: 'hidden',
    dark: true,
    fontScale: 1.3
  })),
  ...['nodeseek', 'linuxdo'].flatMap((source) =>
    ['message', 'topic'].map((entry) => ({
      id: `expressions-${source}-${entry}`,
      source,
      entry,
      mode: 'rich',
      presentation: 'sheet',
      stress: 'expressions',
      keyboard: 'hidden'
    }))
  ),
  ...['nodeseek', 'linuxdo'].flatMap((source) =>
    ['rich', 'source'].flatMap((mode) =>
      ['sheet', 'fullscreen'].map((presentation) => ({
        id: `expressions-${source}-${mode}-${presentation}`,
        source,
        mode,
        presentation,
        entry: 'reply',
        stress: 'expressions',
        keyboard: 'hidden',
        dark: mode === 'source'
      }))
    )
  ),
  ...['nodeseek', 'linuxdo', 'yaohuo'].map((source) => ({
    id: `topic-edit-${source}-success`,
    source,
    entry: 'topic-edit',
    outcome: 'success'
  })),
  { id: 'topic-edit-nodeseek-unknown', source: 'nodeseek', entry: 'topic-edit', outcome: 'unconfirmed' },
  { id: 'topic-edit-yaohuo-restart', source: 'yaohuo', entry: 'topic-edit', stress: 'restart' },
  ...topicCreationCases,
  ...['nodeseek', 'linuxdo'].flatMap((source) =>
    ['rich', 'source'].flatMap((mode) =>
      ['sheet', 'fullscreen'].flatMap((presentation) =>
        ['shown', 'hidden'].map((keyboard) => ({
          id: `${source}-${mode}-${presentation}-${keyboard}`,
          source,
          mode,
          presentation,
          keyboard,
          entry: 'reply'
        }))
      )
    )
  ),
  ...['nodeseek', 'linuxdo', 'yaohuo'].flatMap((source) =>
    (source === 'yaohuo' ? ['reply', 'message'] : ['floor', 'edit', 'message']).flatMap((entry) =>
      ['success', 'network-error'].map((outcome) => ({
        id: `${source}-${entry}-${outcome}`,
        source,
        entry,
        outcome,
        mode: 'rich',
        presentation: 'sheet',
        keyboard: 'shown'
      }))
    )
  ),
  ...['reopen', 'cycles', 'image', 'delay', 'ime-fast', 'ime-slow'].map((stress) => ({
    id: `stress-${stress}`,
    source: 'nodeseek',
    entry: 'reply',
    outcome: 'success',
    stress,
    mode: 'rich',
    presentation: 'fullscreen',
    keyboard: stress === 'image' ? 'hidden' : 'shown'
  })),
  ...[false, true].map((dark) => ({
    id: `fullscreen-${dark ? 'dark' : 'light'}`,
    source: 'nodeseek',
    entry: 'reply',
    outcome: 'success',
    dark,
    mode: 'rich',
    presentation: 'fullscreen',
    keyboard: 'hidden'
  }))
];

export function composerSourceHash(sourceRoot = root) {
  const files = [];
  function walk(relative) {
    for (const entry of readdirSync(path.join(sourceRoot, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(name);
      else if (/\.(tsx?|js|json|patch|kt|java|xml|css)$/.test(name) && !/\.test\.[^.]+$/.test(name)) files.push(name);
    }
  }
  for (const directory of [
    'src',
    'plugins',
    'patches',
    'dev/composer-proof',
    'modules/forum-platform/android/src/main',
    'modules/forum-content-selection/android/src/main'
  ])
    walk(directory);
  files.push(
    'tests/ui/composerSubmissionFixture.tsx',
    'tests/ui/composerMessageFixture.tsx',
    'tests/ui/topicCreationFixture.tsx',
    'tests/helpers/topicCreationTransport.ts',
    'tests/helpers/topicEditingTransport.ts',
    'tests/helpers/accountSessions.ts',
    'modules/forum-platform/android/build.gradle',
    'modules/forum-platform/android/consumer-rules.pro',
    'modules/forum-platform/expo-module.config.json',
    'modules/forum-content-selection/android/build.gradle',
    'modules/forum-content-selection/expo-module.config.json',
    'scripts/device-proof-build.mjs',
    'scripts/release-environment.mjs',
    'package-lock.json',
    'app.json'
  );
  return hash(
    files
      .sort()
      .map((file) => `${file}:${hash(readFileSync(path.join(sourceRoot, file)))}`)
      .join('\n')
  );
}

export function assertTopicCreationReceipt(receipt, expected) {
  assertComposerReceipt(receipt, expected);
  const value = receipt.topic;
  if (!value?.ready || value.error || value.blockedRequests !== 0)
    throw new Error('Topic proof is not ready or made an unmatched request');
  const sources = ['nodeseek', 'linuxdo', 'yaohuo'];
  if (expected.noWrites) {
    if (
      value.writes !== 0 ||
      Object.keys(value.attempts).length !== 0 ||
      sources.some((source) => !value.drafts[source]?.retained)
    )
      throw new Error('Local topic interaction lost a draft or dispatched a request');
    return;
  }
  if (value.writes !== 1 || value.attempts[expected.source] !== expected.status)
    throw new Error('Topic submission count or durable attempt status mismatch');
  const accepted = ['posted', 'enqueued'].includes(expected.status);
  if (accepted ? !value.drafts[expected.source]?.empty : !value.drafts[expected.source]?.retained)
    throw new Error('Topic outcome did not preserve/clear the correct draft');
  if (sources.filter((source) => source !== expected.source).some((source) => !value.drafts[source]?.retained))
    throw new Error('Topic outcome changed another site draft');
  if (accepted ? value.route === 'TopicComposer' : value.route !== 'TopicComposer')
    throw new Error('Topic outcome route mismatch');
  if (expected.source === 'yaohuo') {
    const fields = value.lastWrite?.fields || {};
    const kind = expected.kind || 'normal';
    const paths = { normal: 'add', gift: 'sendmoney', poll: 'addvote', resources: 'addurl', files: 'addfile' };
    if (
      value.lastWrite?.path !== `/bbs/book_view_${paths[kind]}.aspx` ||
      fields.book_title !== 1 ||
      fields.book_content !== 1
    )
      throw new Error('Yaohuo form target or common fields mismatch');
    const required =
      kind === 'gift'
        ? { freemoney: 1, freerule2: 1 }
        : kind === 'poll'
          ? { vote: 3, num: 1 }
          : kind === 'resources'
            ? { file_title: 1, file_url: 1, file_size: 1, file_ext: 1, file_info: 1 }
            : kind === 'files'
              ? { book_file: 1, book_file_info: 1, num: 1 }
              : { sendmoney: 1 };
    if (Object.entries(required).some(([name, count]) => fields[name] !== count))
      throw new Error('Yaohuo active form fields mismatch');
    const forbidden =
      kind === 'normal'
        ? ['freemoney', 'vote', 'book_file', 'file_url']
        : kind === 'gift'
          ? ['sendmoney', 'vote', 'book_file', 'file_url']
          : kind === 'poll'
            ? ['sendmoney', 'book_file', 'file_url']
            : kind === 'resources'
              ? ['sendmoney', 'freemoney', 'vote', 'book_file']
              : ['sendmoney', 'freemoney', 'vote', 'file_url'];
    if (forbidden.some((name) => fields[name])) throw new Error('Yaohuo submitted inactive fields');
  }
}

export function assertTopicEditReceipt(receipt, expected) {
  assertComposerReceipt(receipt, expected);
  const value = receipt.topic;
  const edit = value?.edit;
  if (
    !value?.ready ||
    value.error ||
    value.blockedRequests ||
    !edit ||
    edit.blockedRequests ||
    !edit.bodyExact ||
    !edit.otherDraftRetained ||
    Object.values(value.drafts).some((draft) => !draft.retained) ||
    Object.keys(value.attempts).length
  )
    throw new Error('Editing changed raw text, another draft or used an unmatched request');
  if (expected.noWrites) {
    if (edit.writes !== 0 || edit.status || edit.title !== expected.title)
      throw new Error('Editing draft was not retained without writes');
  } else if (
    edit.writes !== (expected.writes ?? 1) ||
    edit.status !== expected.status ||
    (expected.status === 'saved'
      ? edit.exists || value.route === 'TopicComposer'
      : !edit.exists || value.route !== 'TopicComposer')
  )
    throw new Error('Edit receipt or target-only cleanup mismatch');
}

export function assertComposerReceipt(receipt, expected) {
  if (
    !receipt ||
    receipt.token !== expected.token ||
    receipt.buildId !== expected.buildId ||
    receipt.isHermes !== true ||
    receipt.isDev !== false
  )
    throw new Error('Stale or mismatched composer receipt');
  if (
    expected.closed &&
    (receipt.visible !== false ||
      receipt.content !== '' ||
      receipt.busy !== false ||
      receipt.keyboardShown !== false ||
      receipt.confirmations !== 1 ||
      receipt.requests !== (expected.requests ?? 1))
  )
    throw new Error('Submission did not settle exactly once into an empty closed composer');
}

export function assertComposerClosed(nodes, before, after) {
  if (
    nodes.some(
      (node) => node.identifier === 'composer-bottom-sheet' && node.visibleToUser !== false && node.rect?.height > 0
    )
  )
    throw new Error('Successful submission left a visible Bottom Sheet');
  if (before.width !== after.width || before.height !== after.height) throw new Error('Screen geometry changed');
  // Empty right edge of the fixture detects a remaining dim backdrop independently of accessibility.
  for (const fraction of [0.5, 0.75]) {
    const offset = (Math.floor(before.height * fraction) * before.width + before.width - 2) * 4;
    if (!before.data.subarray(offset, offset + 3).equals(after.data.subarray(offset, offset + 3)))
      throw new Error('Closed composer left visible sheet/backdrop pixels');
  }
}

export function composerSafeTop(windowInsets, requireCutout = false) {
  const bar = windowInsets.match(/type=statusBars[^\r\n]*frame=\[0,0\]\[\d+,(\d+)\]/);
  if (!bar) throw new Error('Status bar geometry unavailable');
  const cutout = Math.max(
    0,
    ...Array.from(windowInsets.matchAll(/mDisplayCutout=DisplayCutout\{insets=Rect\(\d+, (\d+) - /g), (match) =>
      Number(match[1])
    )
  );
  if (requireCutout && cutout === 0) throw new Error('Requested cutout has no effective safe inset');
  return Math.max(Number(bar[1]), cutout);
}

export function assertTopicCreationKeyboardGeometry(nodes, windowInsets, keyboardShown) {
  const display = windowInsets.match(/mDisplayFrame=Rect\(0, 0 - (\d+), (\d+)\)/);
  const ime = windowInsets.match(/type=ime[^\r\n]*?\bframe=\[0,(\d+)\]\[(\d+),(\d+)\][^\r\n]*?\bvisible=(true|false)/);
  const navigation = windowInsets.match(/type=navigationBars[^\r\n]*?\bframe=\[0,(\d+)\]\[(\d+),(\d+)\]/);
  if (!display || !ime || !navigation) throw new Error('Topic native window geometry unavailable');
  if (!/mCurrentFocus=Window\{[^\r\n]*com\.wz\.reader\/com\.wz\.reader\.MainActivity\}/.test(windowInsets))
    throw new Error('Topic activity has not regained window focus');
  const width = Number(display[1]);
  const height = Number(display[2]);
  const imeVisible = ime[4] === 'true';
  if (imeVisible !== keyboardShown) throw new Error('Topic native IME visibility did not settle');
  const navigationTop = Number(navigation[1]);
  const footerBottom = imeVisible ? Number(ime[1]) : navigationTop;
  const safeAreaBottom = footerBottom + height - navigationTop;
  const safeArea = nodes.find((node) => node.identifier === 'create-topic-safe-area')?.rect;
  const footer = nodes.find((node) => node.label === '发帖常用工具栏')?.rect;
  const near = (actual, expected) => Number.isFinite(actual) && Math.abs(actual - expected) <= 3;
  if (
    !safeArea ||
    !near(safeArea.x, 0) ||
    !near(safeArea.y, 0) ||
    !near(safeArea.width, width) ||
    !near(safeArea.y + safeArea.height, safeAreaBottom)
  )
    throw new Error(`Topic safe area retained incorrect keyboard space: ${JSON.stringify(safeArea)}`);
  if (!footer || !(footer.height > 0) || !near(footer.y + footer.height, footerBottom))
    throw new Error(`Topic footer is detached from the visible bottom: ${JSON.stringify(footer)}`);
  const editor = nodes.find((node) => node.identifier === 'structured-composer-editor-frame')?.rect;
  const imageButton = nodes.find((node) => node.label === '图片')?.rect;
  if (!editor || !imageButton || imageButton.y - editor.y < imageButton.height)
    throw new Error('Topic body has less than one toolbar target of visible editing space');
  return { width, height, imeVisible, navigationTop, footerBottom, safeArea, footer, editor, imageButton };
}

export function assertComposerFullscreen(nodes, screenshot, safeTop) {
  const sheet = nodes.find((node) => node.identifier === 'composer-bottom-sheet');
  if (!sheet || sheet.rect.y !== 0) throw new Error(`Fullscreen background starts at ${sheet?.rect?.y}, expected 0`);
  const close = nodes.find((node) => ['收起回复', '取消楼层回复', '取消编辑', '取消'].includes(node.label));
  if (!close || close.rect.y < safeTop) throw new Error('Fullscreen toolbar overlaps the safe top inset');
  const pixel = (y) =>
    screenshot.data.subarray(
      (y * screenshot.width + screenshot.width - 2) * 4,
      (y * screenshot.width + screenshot.width - 2) * 4 + 3
    );
  if (!pixel(Math.floor(safeTop / 2)).equals(pixel(safeTop + 3)))
    throw new Error('Fullscreen status-bar background has a seam');
}

async function main() {
  const { values } = parseArgs({
    options: {
      serial: { type: 'string' },
      output: { type: 'string' },
      build: { type: 'boolean' },
      apk: { type: 'string' },
      'require-cutout': { type: 'boolean' },
      cases: { type: 'string' },
      'ime-cycles': { type: 'string' },
      'ime-chars': { type: 'string' },
      'ime-timeout-minutes': { type: 'string' }
    }
  });
  if (!values.serial || !values.output || Boolean(values.build) === Boolean(values.apk))
    throw new Error('Use --serial --output and exactly one of --build / --apk');
  const imeLimits = composerImeStressLimits(values);
  const output = path.resolve(values.output);
  const relative = path.relative(path.join(root, '.codex-tmp'), output);
  if (relative.startsWith('..') || path.isAbsolute(relative) || existsSync(output))
    throw new Error('Use a new .codex-tmp output directory');
  mkdirSync(output, { recursive: true });
  const adb = (...args) =>
    execFileSync('adb', ['-s', values.serial, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  const avd = adb('emu', 'avd', 'name').split(/\r?\n/)[0].trim();
  assertComposerProofAvd(avd);
  const identity = () => adb('shell', 'dumpsys', 'package', pkg).match(/firstInstallTime=([^\r\n]+)/)?.[1];
  const installedAt = identity();
  if (!installedAt) throw new Error('Expected an existing isolated proof installation');
  const ime = adb('shell', 'settings', 'get', 'secure', 'default_input_method');
  if (ime.includes('imehelper')) throw new Error('Select a real keyboard on the isolated device before running');
  const windowAnimationScale = adb('shell', 'settings', 'get', 'global', 'window_animation_scale');
  const setWindowAnimationScale = (value) =>
    value === 'null'
      ? adb('shell', 'settings', 'delete', 'global', 'window_animation_scale')
      : adb('shell', 'settings', 'put', 'global', 'window_animation_scale', value);
  for (const patch of readdirSync(path.join(root, 'patches')).filter((name) => name.endsWith('.patch')))
    execFileSync('git', ['apply', '--reverse', '--check', '--whitespace=nowarn', path.join(root, 'patches', patch)], {
      cwd: root,
      windowsHide: true
    });
  let apk = values.apk && path.resolve(values.apk);
  if (values.build) {
    execFileSync(process.execPath, ['scripts/build-composer-editor.mjs'], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true
    });
    const sourceHash = composerSourceHash();
    const config = buildDeviceProof(root, {
      name: 'composer-proof',
      entryFile: 'dev/composer-proof/index.tsx',
      scheme: 'wzcomposerproof'
    });
    apk = config.apk;
    if (sourceHash !== composerSourceHash())
      throw new Error('Composer sources changed during build; rebuild before replay');
    writeFileSync(
      `${apk}.json`,
      JSON.stringify({ buildId: config.buildId, sourceHash, apkHash: hash(readFileSync(apk)) })
    );
  }
  const artifact = JSON.parse(readFileSync(`${apk}.json`, 'utf8'));
  if (artifact.sourceHash !== composerSourceHash() || artifact.apkHash !== hash(readFileSync(apk)))
    throw new Error('APK does not match the current composer sources');
  const buildTools = path.join(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '', 'build-tools');
  const signer = readdirSync(buildTools)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((version) => path.join(buildTools, version, 'lib/apksigner.jar'))
    .find(existsSync);
  if (!signer) throw new Error('Android apksigner unavailable');
  const signingIdentity = (file) =>
    apkSigning.singleApkSignerSha256(
      execFileSync('java', ['-jar', signer, 'verify', '--print-certs', file], { encoding: 'utf8', windowsHide: true })
    );
  const installedPath = adb('shell', 'pm', 'path', pkg)
    .split(/\r?\n/)[0]
    .replace(/^package:/, '');
  const installedCopy = path.join(output, 'previous.apk');
  adb('pull', installedPath, installedCopy);
  const certificate = signingIdentity(apk);
  if (!certificate || certificate !== signingIdentity(installedCopy))
    throw new Error('APK signer mismatch; installation frozen');
  adb('install', '-r', apk);
  if (identity() !== installedAt) throw new Error('Installation identity changed; device changes frozen');
  const report = {
    artifact,
    runnerHash: hash(readFileSync(fileURLToPath(import.meta.url))),
    expressionOracleHash: hash(readFileSync(path.join(root, 'scripts/composer-expression-geometry.mjs'))),
    apk,
    avd,
    serial: values.serial,
    installedAt,
    ime,
    windowAnimationScale,
    certificate,
    webView: adb('shell', 'dumpsys', 'webviewupdate'),
    size: adb('shell', 'wm', 'size'),
    fontScale: adb('shell', 'settings', 'get', 'system', 'font_scale'),
    overlays: adb('shell', 'cmd', 'overlay', 'list'),
    results: []
  };
  writeFileSync(path.join(output, 'environment.json'), JSON.stringify(report, null, 2));
  const chosen = values.cases
    ? values.cases.split(',').map((id) => {
        const scenario = composerCases.find((value) => value.id === id);
        if (!scenario) throw new Error(`Unknown composer case: ${id}`);
        return scenario;
      })
    : composerCases;
  const session = `composer-${randomUUID()}`;
  const agent = (args, capture = true) =>
    runAgentDevice(
      [
        ...args,
        '--platform',
        'android',
        '--serial',
        values.serial,
        '--device',
        avd.replaceAll('_', ' '),
        '--session',
        session,
        '--state-dir',
        path.join(output, 'agent')
      ],
      { capture, echoCapture: false }
    );
  const replay = (name, submitLabel, launcher = '打开测试回复', close = '收起回复') =>
    agent(composerReplayArgs({ name, avd, submitLabel, launcher, close }));
  const launch = (url) => {
    adb('shell', 'am', 'force-stop', pkg);
    adb('shell', 'am', 'start', '-n', `${pkg}/.MainActivity`, '-a', 'android.intent.action.VIEW', '-d', url);
  };
  const capture = (directory, name) => {
    const image = execFileSync('adb', ['-s', values.serial, 'exec-out', 'screencap', '-p'], {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024
    });
    writeFileSync(path.join(directory, `${name}.png`), image);
    return PNG.sync.read(image);
  };
  async function receipt(token, condition = () => true, timeout = 20000) {
    const deadline = Date.now() + timeout;
    let lastReceipt;
    while (Date.now() < deadline) {
      let value;
      try {
        value = JSON.parse(adb('shell', 'run-as', pkg, 'cat', 'cache/composer-proof.json'));
      } catch {}
      if (value?.token === token) lastReceipt = value;
      if (value?.token === token && condition(value)) {
        assertComposerReceipt(value, { token, buildId: artifact.buildId });
        return value;
      }
      await delay(100);
    }
    throw Object.assign(new Error('Composer receipt timed out'), { lastReceipt });
  }
  const snapshot = (directory, name) => {
    const result = JSON.parse(agent(['snapshot', '--json']));
    writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(result));
    if (!result.success || !Array.isArray(result.data?.nodes)) throw new Error('Native snapshot unavailable');
    return result.data.nodes;
  };
  const waitForClosed = async (directory, name, before) => {
    const deadline = Date.now() + 8000;
    let closeError;
    do {
      try {
        assertComposerClosed(snapshot(directory, name), before, capture(directory, name));
        return;
      } catch (error) {
        closeError = error;
      }
      await delay(150);
    } while (Date.now() < deadline);
    throw closeError;
  };
  const verifyExpressions = async (scenario, token, directory, restoredLabel) => {
    const waitForKeyboard = async (shown) => {
      const deadline = Date.now() + 30000;
      do {
        const windowInsets = adb('shell', 'dumpsys', 'window');
        writeFileSync(path.join(directory, 'expressions-window.txt'), windowInsets);
        const ime = windowInsets.match(/type=ime[^\r\n]*?\bvisible=(true|false)/);
        if (ime && (ime[1] === 'true') === shown) return;
        await delay(100);
      } while (Date.now() < deadline);
      throw new Error('Expression native keyboard visibility did not settle');
    };
    const verifyInsets = (name, keyboardShown) => {
      const windowInsets = adb('shell', 'dumpsys', 'window');
      writeFileSync(path.join(directory, `${name}-window.txt`), windowInsets);
      const native = snapshot(directory, name);
      const insets = assertComposerExpressionInsets(native, windowInsets, keyboardShown);
      writeFileSync(path.join(directory, `${name}-insets.json`), JSON.stringify(insets));
      return native;
    };
    replay('expressions-open', restoredLabel);
    await waitForKeyboard(false);
    agent(['wait', 'label="关闭"']);
    const dom = await connectComposerImeDom(adb);
    try {
      const imageDeadline = Date.now() + 30000;
      while ((await dom.expressions()).loadedImages === 0) {
        if (Date.now() >= imageDeadline) throw new Error('Expression images did not load in the visible picker');
        await delay(100);
      }
      const opened = assertComposerExpressionGeometry(await dom.expressions());
      writeFileSync(path.join(directory, 'expressions-opened-geometry.json'), JSON.stringify(opened));
      const nativeNodes = verifyInsets('expressions-opened', false);
      capture(directory, 'expressions-opened');
      if (scenario.source === 'nodeseek') {
        agent(['scroll', 'down', '700']);
        const scrolled = assertComposerExpressionGeometry(await dom.expressions(), opened);
        if (scrolled.scrollTop <= 0) throw new Error('Sticker scroll did not move the image grid');
        writeFileSync(path.join(directory, 'expressions-scrolled.json'), JSON.stringify(scrolled));
        capture(directory, 'expressions-scrolled');
        agent(['press', 'label="洋葱头"']);
        const switched = assertComposerExpressionGeometry(await dom.expressions(), opened);
        if (switched.scrollTop !== 0) throw new Error('Changed category did not start at the top');
        agent(['press', 'label="AC娘"']);
      } else {
        // Android can omit the search input's name. Its actual AX rectangle
        // distinguishes it from the draft input above the picker.
        const close = nativeNodes.find((node) => node.label === '关闭')?.rect;
        if (!close) throw new Error('Expression close control is not accessible');
        const search = nativeNodes.find(
          (node) => node.type === 'android.widget.EditText' && Math.abs(node.rect.y - close.y) < close.height / 2
        );
        if (!search?.ref) throw new Error('Expression search input is not accessible');
        agent(['press', `@${search.ref}`]);
        await waitForKeyboard(true);
        const searched = assertComposerExpressionGeometry(await dom.expressions());
        verifyInsets('expressions-search', true);
        writeFileSync(path.join(directory, 'expressions-search.json'), JSON.stringify(searched));
        capture(directory, 'expressions-search');
        adb('shell', 'input', 'keyevent', 'KEYCODE_ESCAPE');
        await waitForKeyboard(false);
      }
      replay('expressions-close', restoredLabel);
      const restored = snapshot(directory, 'expressions-restored');
      if (!restored.some((node) => node.label === restoredLabel) || !restored.some((node) => node.label === '表情'))
        throw new Error('Expression close did not restore composer controls');
      capture(directory, 'expressions-restored');
      if (scenario.entry !== 'topic') {
        const readBody = () =>
          dom.evaluate(
            `document.querySelector('.editor-pane.active .ProseMirror, .source-pane.active .cm-content')?.textContent.trim()`
          );
        const content = await readBody();
        replay('expressions-open', restoredLabel);
        agent(['press', `label="${scenario.mode === 'source' ? '富文本' : '源码'}"`]);
        await receipt(token, (value) => value.keyboardShown === true);
        if ((await readBody()) !== content) throw new Error('Mode return changed the actual editor document');
        const switched = snapshot(directory, 'expressions-mode-return');
        if (switched.some((node) => node.label === '关闭'))
          throw new Error('Mode focus left expressions behind the keyboard');
        capture(directory, 'expressions-mode-return');
        agent(['press', `label="${scenario.mode === 'source' ? '源码' : '富文本'}"`]);
        await receipt(token, (value) => value.keyboardShown === true);
        if (scenario.source === 'nodeseek') {
          replay('expressions-open', restoredLabel);
          agent(['press', 'label="ac01"']);
          await receipt(token, (value) => value.keyboardShown === true);
          const inserted = await dom.evaluate(
            `Boolean(document.querySelector('.ProseMirror [data-composer-node="forum-expression"][aria-label="ac01"]')) || Boolean(document.querySelector('.cm-content')?.textContent.includes(':ac01:'))`
          );
          if (!inserted) throw new Error('Selected sticker did not enter the actual editor document');
          const selected = snapshot(directory, 'expressions-selected');
          if (selected.some((node) => node.label === '关闭'))
            throw new Error('Selected expression did not return to the editor');
          capture(directory, 'expressions-selected');
        }
      }
    } finally {
      dom.close();
    }
  };
  try {
    for (const scenario of chosen) {
      const token = randomUUID().replaceAll('-', '');
      const directory = path.join(output, scenario.id);
      mkdirSync(directory);
      const result = { ...scenario, token, passed: false };
      report.results.push(result);
      const persist = () => writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
      try {
        result.windowAnimationScale =
          scenario.stress === 'ime-fast' ? '0' : scenario.stress === 'ime-slow' ? '5' : windowAnimationScale;
        setWindowAnimationScale(result.windowAnimationScale);
        launch(
          `'wzcomposerproof://${token}?source=${scenario.source}&entry=${scenario.entry}&outcome=${scenario.outcome || 'success'}&theme=${scenario.dark ? 'dark' : 'light'}&fontScale=${scenario.fontScale || 1}&stress=${scenario.stress || ''}'`
        );
        await receipt(token, undefined, 60000);
        if (scenario.entry === 'topic-edit') {
          await receipt(token, (value) => value.topic?.ready === true);
          agent(['open', pkg]);
          agent(['press', 'text="编辑测试主帖"']);
          await receipt(token, (value) => value.topic?.route === 'TopicComposer' && value.topic?.edit?.exists);
          const readyDeadline = Date.now() + 30000;
          let original;
          do {
            original = snapshot(directory, 'original');
            if (isTopicCreationViewReady(original, scenario.source) && JSON.stringify(original).includes('原始正文'))
              break;
            if (Date.now() > readyDeadline) throw new Error('Original editing body did not become visible');
            await delay(300);
          } while (true);
          capture(directory, 'original');
          const title = '中文主帖编辑验证';
          const titleInput = original.find(
            (node) => node.type === 'android.widget.EditText' && node.value === `Local ${scenario.source} topic proof`
          );
          if (!titleInput?.ref) throw new Error('Original editable title is missing');
          agent(['press', `@${titleInput.ref}`]);
          const focusedTitle = snapshot(directory, 'title-focused').find(
            (node) => node.type === 'android.widget.EditText' && node.value === `Local ${scenario.source} topic proof`
          );
          if (!focusedTitle?.ref) throw new Error('Focused editable title is missing');
          agent(['fill', `@${focusedTitle.ref}`, title]);
          // Restore the real IME after the automation keyboard finishes entering Chinese text.
          adb('shell', 'ime', 'set', ime);
          const editedInput = snapshot(directory, 'title-entered').find(
            (node) => node.type === 'android.widget.EditText' && node.value === title
          );
          if (!editedInput?.ref) throw new Error('Chinese title input was not retained');
          agent(['press', `@${editedInput.ref}`]);
          await receipt(token, (value) => value.keyboardShown === true && value.topic?.edit?.title === title);
          snapshot(directory, 'keyboard-shown');
          capture(directory, 'keyboard-shown');
          adb('shell', 'input', 'keyevent', 'KEYCODE_ESCAPE');
          await receipt(token, (value) => value.keyboardShown === false);
          if (scenario.stress === 'restart') {
            agent(['press', 'label="返回"']);
            await receipt(token, (value) => value.topic?.route === 'MainTabs');
            launch(`'wzcomposerproof://${token}?source=${scenario.source}&entry=topic-edit&stress=restart'`);
            await receipt(token, (value) => value.topic?.ready && value.topic.route === 'MainTabs');
            agent(['open', pkg]);
            agent(['press', 'text="编辑测试主帖"']);
            const restored = await receipt(
              token,
              (value) => value.topic?.route === 'TopicComposer' && value.topic?.edit?.title === title
            );
            assertTopicEditReceipt(restored, { token, buildId: artifact.buildId, noWrites: true, title });
            writeFileSync(path.join(directory, 'restored.json'), JSON.stringify(restored));
          } else {
            agent(['press', 'label="保存修改"']);
            const status = scenario.outcome === 'success' ? 'saved' : 'unknown';
            const settled = await receipt(
              token,
              (value) =>
                value.topic?.edit?.status === status &&
                (status === 'saved' ? value.topic.route === 'MainTabs' : value.topic.route === 'TopicComposer')
            );
            assertTopicEditReceipt(settled, { token, buildId: artifact.buildId, status });
            writeFileSync(path.join(directory, 'settled.json'), JSON.stringify(settled));
            if (status === 'saved') {
              agent(['press', 'text="编辑测试主帖"']);
              await receipt(token, (value) => value.topic?.route === 'TopicComposer' && value.topic?.edit?.exists);
              // Reacquire the test IME after the first pass restored the real keyboard.
              agent(['open', pkg, '--test-ime']);
              const deadline = Date.now() + 30000;
              let reopened;
              do {
                reopened = snapshot(directory, 'reopened').find(
                  (node) => node.type === 'android.widget.EditText' && node.value === title
                );
                if (reopened?.ref) break;
                if (Date.now() > deadline) throw new Error('Saved topic could not be edited again');
                await delay(300);
              } while (true);
              const nextTitle = '中文主帖再次编辑验证';
              agent(['fill', `@${reopened.ref}`, nextTitle]);
              adb('shell', 'ime', 'set', ime);
              await receipt(token, (value) => value.topic?.edit?.title === nextTitle);
              adb('shell', 'input', 'keyevent', 'KEYCODE_ESCAPE');
              await receipt(token, (value) => value.keyboardShown === false);
              agent(['press', 'label="保存修改"']);
              const repeated = await receipt(
                token,
                (value) =>
                  value.topic?.edit?.writes === 2 &&
                  value.topic?.edit?.status === 'saved' &&
                  value.topic.route === 'MainTabs'
              );
              assertTopicEditReceipt(repeated, { token, buildId: artifact.buildId, status, writes: 2 });
              writeFileSync(path.join(directory, 'repeated.json'), JSON.stringify(repeated));
            }
          }
          snapshot(directory, 'settled');
          capture(directory, 'settled');
          result.passed = true;
        } else if (scenario.entry === 'topic') {
          const waitForTitle = async (source, name) => {
            const deadline = Date.now() + 30000;
            while (Date.now() < deadline) {
              const nodes = snapshot(directory, name);
              if (isTopicCreationViewReady(nodes, source)) return;
              await delay(300);
            }
            throw new Error(`Topic title or editor did not become ready for ${source}`);
          };
          await receipt(token, (value) => value.topic?.ready === true);
          agent(['open', pkg]);
          agent(['press', 'text="打开测试发帖"']);
          await waitForTitle(scenario.source, 'opened');
          capture(directory, 'opened');
          if (scenario.stress === 'expressions') {
            await verifyExpressions(scenario, token, directory, '表情');
            result.expressions = true;
          }
          if (scenario.stress === 'panel-keyboard') {
            const verifyGeometry = async (stage, keyboardShown) => {
              const observed = await receipt(token, (value) => value.keyboardShown === keyboardShown);
              assertTopicCreationReceipt(observed, { token, buildId: artifact.buildId, noWrites: true });
              const nodes = snapshot(directory, stage);
              const windowInsets = adb('shell', 'dumpsys', 'window');
              writeFileSync(path.join(directory, `${stage}-window.txt`), windowInsets);
              writeFileSync(path.join(directory, `${stage}-receipt.json`), JSON.stringify(observed));
              capture(directory, stage);
              const geometry = assertTopicCreationKeyboardGeometry(nodes, windowInsets, keyboardShown);
              writeFileSync(path.join(directory, `${stage}-geometry.json`), JSON.stringify(geometry));
            };
            adb('shell', 'ime', 'set', ime);
            if ((await receipt(token)).keyboardShown) adb('shell', 'input', 'keyevent', 'KEYCODE_ESCAPE');
            await verifyGeometry('before-keyboard', false);
            replay('topic-focus-body', '发布');
            await verifyGeometry('keyboard-shown', true);
            agent(['press', 'label="文字格式"']);
            await receipt(token, (value) => value.keyboardShown === false);
            const formatNodes = snapshot(directory, 'format-panel');
            if (!formatNodes.some((node) => node.label === '粗体')) throw new Error('Topic format tools unavailable');
            capture(directory, 'format-panel');
            agent(['press', 'label="查看标题与标签"']);
            await receipt(token, (value) => value.keyboardShown === true);
            const titleNodes = snapshot(directory, 'title-restored');
            if (
              !titleNodes.some(
                (node) =>
                  node.type === 'android.widget.EditText' && node.value === `Local ${scenario.source} topic proof`
              ) ||
              titleNodes.some((node) => node.label === '粗体')
            )
              throw new Error('Title focus did not replace the format panel');
            capture(directory, 'title-restored');
            agent(['press', 'label="输入正文"']);
            await verifyGeometry('keyboard-restored', true);
            replay('topic-panel-close', '发布');
            await verifyGeometry('after-panel-close', false);
            agent(['open', pkg, '--test-ime']);
            replay('topic-focus-body', '发布');
            agent(['type', 'Long draft line\n'.repeat(100)]);
            adb('shell', 'ime', 'set', ime);
            agent(['press', 'label="文字格式"']);
            await receipt(token, (value) => value.keyboardShown === false);
            const longFormatNodes = snapshot(directory, 'long-format-panel');
            capture(directory, 'long-format-panel');
            if (!longFormatNodes.some((node) => String(node.value || node.label || '').includes('Long draft line')))
              throw new Error('Long topic body was not entered');
            const shortToolbar = formatNodes.find((node) => node.label === '图片')?.rect;
            const longToolbar = longFormatNodes.find((node) => node.label === '图片')?.rect;
            if (!shortToolbar || !longToolbar || Math.abs(shortToolbar.y - longToolbar.y) > 3)
              throw new Error('Long topic body squeezed the format panel');
            agent(['press', 'label="更多编辑工具"']);
            agent(['press', 'label="撤销"']);
            await receipt(token, (value) => value.topic?.drafts[scenario.source]?.retained);
            replay('topic-panel-close', '发布');
            await verifyGeometry('after-long-panel-close', false);
          }
          if (
            scenario.outcome === 'success' &&
            (!scenario.stress || ['files', 'resources'].includes(scenario.stress))
          ) {
            // Inspect settings, image history and supported file panels without picking or uploading.
            agent(['press', 'label="帖子设置"']);
            snapshot(directory, 'posting-options');
            capture(directory, 'posting-options');
            agent(['press', 'label="关闭发帖选项"']);
            agent(['press', 'label="附件与草稿"']);
            snapshot(directory, 'more-actions');
            agent(['press', 'label="图片上传记录"']);
            snapshot(directory, 'image-records');
            capture(directory, 'image-records');
            agent(['press', 'label="关闭发帖选项"']);
            if (scenario.source === 'linuxdo' || scenario.stress === 'files') {
              agent(['press', 'label="附件与草稿"']);
              agent(['press', `label="${scenario.source === 'linuxdo' ? '附件' : '文件 1'}"`]);
              snapshot(directory, 'file-panel');
              capture(directory, 'file-panel');
              agent(['press', 'label="关闭发帖选项"']);
            }
            await waitForTitle(scenario.source, 'ready-after-panels');
          }
          if (scenario.stress === 'switch') {
            for (const [source, label] of [
              ['linuxdo', 'linux.do'],
              ['yaohuo', '妖火'],
              ['nodeseek', 'NodeSeek']
            ]) {
              agent(['press', 'label="切换发帖网站"']);
              agent(['press', `label="选择 ${label}"`]);
              await waitForTitle(source, `switched-${source}`);
              capture(directory, `switched-${source}`);
            }
          } else if (scenario.stress === 'restart') {
            launch(`'wzcomposerproof://${token}?source=${scenario.source}&entry=topic&stress=restart'`);
            await receipt(token, (value) => value.topic?.ready && value.topic?.route === 'MainTabs');
            agent(['open', pkg]);
            agent(['press', 'text="打开测试发帖"']);
            await waitForTitle(scenario.source, 'restarted');
            capture(directory, 'restarted');
          }
          if (['switch', 'restart', 'panel-keyboard', 'expressions'].includes(scenario.stress)) {
            const settled = await receipt(token, (value) => value.topic?.route === 'TopicComposer');
            assertTopicCreationReceipt(settled, { token, buildId: artifact.buildId, noWrites: true });
            writeFileSync(path.join(directory, 'settled.json'), JSON.stringify(settled));
          } else {
            agent(['press', 'label="发布"']);
            if (scenario.stress === 'gift') agent(['press', 'text="确认发布"']);
            const status =
              scenario.outcome === 'success'
                ? 'posted'
                : scenario.outcome === 'enqueued'
                  ? 'enqueued'
                  : scenario.outcome === 'rejected'
                    ? 'rejected'
                    : 'unknown';
            const settled = await receipt(token, (value) =>
              isTopicCreationReceiptSettled(value, scenario.source, status)
            );
            assertTopicCreationReceipt(settled, {
              token,
              buildId: artifact.buildId,
              source: scenario.source,
              status,
              kind: scenario.stress
            });
            writeFileSync(path.join(directory, 'settled.json'), JSON.stringify(settled));
            snapshot(directory, 'settled');
            capture(directory, 'settled');
            if (scenario.stress === 'inactive-receipt') {
              agent(['press', 'text="返回发帖"']);
              await receipt(token, (value) => value.topic?.route === 'TopicComposer');
              const nodes = snapshot(directory, 'returned');
              if (JSON.stringify(nodes).includes('上次发布结果尚未确认'))
                throw new Error('Confirmed receipt remained unresolved on the retained route');
              if (nodes.some((node) => node.label?.includes(`Local ${scenario.source} topic proof`)))
                throw new Error('Accepted draft remained in the retained editor');
              agent(['fill', 'label="标题"', 'Retained route remains editable']);
              agent(['press', 'label="返回"']);
              await receipt(
                token,
                (value) =>
                  value.topic?.route === 'MainTabs' &&
                  value.topic?.writes === 1 &&
                  value.topic.drafts[scenario.source]?.exists &&
                  !value.topic.drafts[scenario.source]?.empty
              );
              snapshot(directory, 'left-after-edit');
              capture(directory, 'left-after-edit');
            }
          }
          result.passed = true;
        } else {
          const submitLabel = scenario.entry === 'edit' ? '保存编辑' : '发送回复';
          const message = scenario.entry === 'message';
          const launcher = message ? (scenario.source === 'nodeseek' ? '发私信' : '回复私信') : '打开测试回复';
          const closeLabel = message
            ? '取消'
            : scenario.entry === 'edit'
              ? '取消编辑'
              : scenario.entry === 'floor'
                ? '取消楼层回复'
                : '收起回复';
          replay(message ? 'open-message' : 'open', submitLabel);
          adb('shell', 'ime', 'set', ime);
          const before = capture(directory, 'before');
          replay('open-editor', submitLabel, launcher);
          await receipt(token, (value) => value.keyboardShown === true);
          if (scenario.source !== 'yaohuo')
            agent(['press', `label="${scenario.mode === 'source' ? '源码' : '富文本'}"`]);
          if (message) {
            // agent-device caches its test IME ownership after open. Restore that IME only
            // for text entry, then use the real keyboard for every layout/submit assertion.
            adb('shell', 'ime', 'set', 'com.callstack.agentdevice.imehelper/.TestInputMethodService');
            replay('message-input', submitLabel);
            adb('shell', 'ime', 'set', ime);
            adb('shell', 'input', 'keyevent', 'KEYCODE_ESCAPE');
            await receipt(token, (value) => value.keyboardShown === false);
            agent(['press', 'id="structured-composer-webview"']);
            await receipt(token, (value) => value.keyboardShown);
          }
          if (scenario.presentation === 'fullscreen') replay('fullscreen', submitLabel);
          if (scenario.stress === 'expressions') {
            await verifyExpressions(scenario, token, directory, submitLabel);
            result.expressions = true;
          }
          let imeContent;
          if (['ime-fast', 'ime-slow'].includes(scenario.stress)) {
            const started = Date.now();
            const deadline = started + imeLimits.timeoutMs;
            const checkpoints = [];
            result.ime = {
              ...imeLimits,
              inputMethod: 'Android InputManager ASCII keyevents with the real IME active',
              compositionInputVerified: false,
              diagnostics: 'Read-only CDP DOM/selection/event observation; adds driver overhead',
              inputBatchChars: 64,
              completedCycles: 0,
              checkpoints
            };
            const imeReceipt = (condition) => {
              const remaining = deadline - Date.now();
              if (remaining <= 0) throw new Error('IME stress observation deadline reached');
              return receipt(token, condition, Math.min(30000, remaining));
            };
            imeContent = (await imeReceipt((value) => value.keyboardShown && value.visible)).content;
            for (let cycle = 1; cycle <= imeLimits.cycles; cycle += 1) {
              if (Date.now() >= deadline) throw new Error('IME stress observation deadline reached');
              const mode = cycle % 2 ? 'source' : 'rich';
              const stage = `ime-${String(cycle).padStart(3, '0')}`;
              const phase = (name) => {
                result.ime.active = { cycle, mode, phase: name, at: Date.now() };
                persist();
              };
              phase('switch-mode');
              agent(['press', `label="${mode === 'source' ? '源码' : '富文本'}"`]);
              phase('focus-editor');
              agent(['press', 'id="structured-composer-webview"']);
              phase('wait-focused-receipt');
              await imeReceipt((value) => value.keyboardShown && value.content === imeContent);
              if (adb('shell', 'settings', 'get', 'secure', 'default_input_method') !== ime)
                throw new Error('IME stress switched away from the real keyboard');
              // Android keyevents enter the actual focused WebView DOM. This does not
              // claim soft-keyboard composition/candidate behavior or Chinese input.
              const input = composerImeInput(cycle, imeLimits.chars);
              const evidence = { cycle, mode, before: imeContent, input };
              const saveEvidence = () =>
                writeFileSync(path.join(directory, `${stage}-input.json`), JSON.stringify(evidence, null, 2));
              let dom;
              let edited;
              let inputStarted;
              try {
                phase('observe-before-input');
                writeFileSync(
                  path.join(directory, `${stage}-before-input-method.txt`),
                  adb('shell', 'dumpsys', 'input_method')
                );
                dom = await connectComposerImeDom(adb);
                evidence.beforeDom = await dom.capture('start');
                saveEvidence();
                phase('native-input');
                inputStarted = Date.now();
                evidence.batches = injectComposerImeInput(adb, input);
                evidence.inputReturnedAt = Date.now();
                // Collect immediately after key injection, before polling can hide selection changes.
                evidence.afterInputDom = await dom.capture('read');
                saveEvidence();
                phase('wait-edited-receipt');
                edited = await imeReceipt(
                  (value) => value.content.length === imeContent.length + input.length && value.content.includes(input)
                );
                evidence.after = edited.content;
                evidence.diff = composerImeEditEvidence(imeContent, edited.content, input);
                evidence.settledDom = await dom.capture('stop');
                saveEvidence();
                assertComposerImeEdit(imeContent, edited.content, input);
              } catch (error) {
                evidence.error = error.message;
                if (error.lastReceipt) {
                  evidence.lastReceipt = error.lastReceipt;
                  evidence.diff = composerImeEditEvidence(imeContent, error.lastReceipt.content, input);
                }
                try {
                  if (dom) evidence.failureDom = await dom.capture('stop');
                  writeFileSync(
                    path.join(directory, `${stage}-failure-input-method.txt`),
                    adb('shell', 'dumpsys', 'input_method')
                  );
                } catch (failure) {
                  evidence.captureError = failure.message;
                }
                saveEvidence();
                error.message = `${stage} ${result.ime.active.phase}: ${error.message}`;
                throw error;
              } finally {
                dom?.close();
              }
              imeContent = edited.content;
              const checkpoint = {
                cycle,
                mode,
                inputChars: input.length,
                documentChars: imeContent.length,
                documentHash: hash(imeContent),
                inputToReceiptMs: Date.now() - inputStarted,
                elapsedMs: Date.now() - started,
                reopened: false
              };
              checkpoints.push(checkpoint);
              persist();
              phase('verify-open-geometry');
              const windowInsets = adb('shell', 'dumpsys', 'window');
              writeFileSync(path.join(directory, `${stage}-window.txt`), windowInsets);
              assertComposerFullscreen(
                snapshot(directory, `${stage}-opened`),
                capture(directory, `${stage}-opened`),
                composerSafeTop(windowInsets, values['require-cutout'])
              );
              phase('close-editor');
              replay('manual-close', submitLabel, launcher, closeLabel);
              phase('wait-closed-receipt');
              await imeReceipt((value) => !value.visible && !value.keyboardShown && value.content === imeContent);
              phase('verify-closed-geometry');
              await waitForClosed(directory, `${stage}-closed`, before);
              phase('reopen-editor');
              replay('open-editor', submitLabel, launcher);
              phase('wait-reopened-receipt');
              await imeReceipt((value) => value.visible && value.keyboardShown && value.content === imeContent);
              replay('fullscreen', submitLabel);
              checkpoint.reopened = true;
              checkpoint.elapsedMs = Date.now() - started;
              result.ime.completedCycles = cycle;
              phase('cycle-complete');
              persist();
              console.log(`${scenario.id}: cycle ${cycle}/${imeLimits.cycles}, ${imeContent.length} document chars`);
            }
          }
          if (scenario.stress === 'cycles') {
            for (let cycle = 0; cycle < 3; cycle++) {
              replay('manual-close', submitLabel, launcher, closeLabel);
              await receipt(token, (value) => !value.visible && !value.keyboardShown);
              replay('open-editor', submitLabel, launcher);
              await receipt(token, (value) => value.visible && value.keyboardShown);
              replay('fullscreen', submitLabel);
            }
          }
          if (scenario.stress === 'image') {
            replay('image-cancel', submitLabel);
            await receipt(token, (value) => value.visible && !value.busy);
            if (!(await receipt(token)).content.includes('Local mock reply; never sent.'))
              throw new Error('Picker cancellation lost draft');
          }
          if (scenario.keyboard === 'hidden') {
            if ((await receipt(token)).keyboardShown) adb('shell', 'input', 'keyevent', 'KEYCODE_ESCAPE');
            await receipt(token, (value) => value.keyboardShown === false);
          }
          if (adb('shell', 'settings', 'get', 'secure', 'default_input_method') !== ime)
            throw new Error('The real IME must be active for layout and submission');
          const beforeSubmit = await receipt(token, (value) => value.keyboardShown === (scenario.keyboard === 'shown'));
          writeFileSync(path.join(directory, 'before-submit.json'), JSON.stringify(beforeSubmit));
          const windowInsets = adb('shell', 'dumpsys', 'window');
          writeFileSync(path.join(directory, 'window-insets.txt'), windowInsets);
          const opened = snapshot(directory, 'opened');
          if (scenario.presentation === 'fullscreen') {
            result.fullscreenError = undefined;
            try {
              result.safeTop = composerSafeTop(windowInsets, values['require-cutout']);
              assertComposerFullscreen(opened, capture(directory, 'fullscreen'), result.safeTop);
            } catch (error) {
              result.fullscreenError = error.message;
            }
          }
          replay('submit', submitLabel);
          if (scenario.stress === 'reopen') {
            const reopened = await receipt(
              token,
              (value) =>
                value.visible && value.content === '' && !value.busy && value.confirmations === 1 && value.keyboardShown
            );
            writeFileSync(path.join(directory, 'reopened-during-close-receipt.json'), JSON.stringify(reopened));
            if (!snapshot(directory, 'reopened-during-close').some((node) => node.label === '发送回复'))
              throw new Error('Old close covered the new session');
            replay('manual-close', submitLabel, launcher, closeLabel);
            result.reopenedDuringClose = true;
          }
          if (scenario.outcome === 'network-error') {
            const rejected = await receipt(
              token,
              (value) =>
                value.requests === 1 &&
                value.confirmations === 0 &&
                (message || (value.busy === false && value.notice === 'Mock network offline'))
            );
            writeFileSync(path.join(directory, 'failed-receipt.json'), JSON.stringify(rejected));
            if (message) replay('failed', submitLabel);
            const failed = snapshot(directory, 'failed');
            if (!failed.some((node) => node.label?.includes('Local mock reply; never sent.')))
              throw new Error('Failed request lost the visible draft');
            replay('manual-close', submitLabel, launcher, closeLabel);
            await receipt(token, (value) => !value.keyboardShown && (message || !value.visible));
            agent(['press', 'text="下一次成功"']);
            replay('open-editor', submitLabel, launcher);
            await receipt(token, (value) => value.keyboardShown);
            const retained = snapshot(directory, 'retained');
            if (!retained.some((node) => node.label?.includes('Local mock reply; never sent.')))
              throw new Error('Reopened failed draft is missing');
            replay('submit', submitLabel);
          }
          const settled = await receipt(
            token,
            (value) =>
              (message ? value.notice === '回复已发送' : value.visible === false) && !value.busy && !value.keyboardShown
          );
          writeFileSync(path.join(directory, 'settled.json'), JSON.stringify(settled));
          assertComposerReceipt(settled, {
            token,
            buildId: artifact.buildId,
            closed: !message,
            requests: scenario.outcome === 'network-error' ? 2 : 1
          });
          if (settled.confirmations !== 1 || settled.requests !== (scenario.outcome === 'network-error' ? 2 : 1))
            throw new Error('Submission count mismatch');
          if (imeContent !== undefined && settled.submittedContents?.[0] !== imeContent)
            throw new Error('The final submission did not contain the complete stressed WebView document');
          // Poll the actual view until it exits; time is a deadline, never the success oracle.
          await waitForClosed(directory, 'closed', before);
          replay('closed', submitLabel);
          result.closed = true;
          replay(
            'open-editor',
            scenario.entry === 'edit' ? '发送回复' : submitLabel,
            scenario.entry === 'edit' ? '打开空白回复' : launcher
          );
          await receipt(token, (value) => value.keyboardShown);
          const reopened = snapshot(directory, 'reopened');
          if (reopened.some((node) => node.label?.includes('Local mock reply; never sent.')))
            throw new Error('Sent document returned on reopen');
          replay('manual-close', submitLabel, launcher, scenario.entry === 'edit' ? '收起回复' : closeLabel);
          result.reopenedEmpty = true;
          if (result.fullscreenError) throw new Error(result.fullscreenError);
          result.passed = true;
        }
      } catch (error) {
        recordComposerFailure({
          result,
          error,
          persist,
          evidence: {
            receipt: () =>
              writeFileSync(
                path.join(directory, 'failure-receipt.json'),
                adb('shell', 'run-as', pkg, 'cat', 'cache/composer-proof.json')
              ),
            screenshot: () => capture(directory, 'failure')
          }
        });
      }
      persist();
      console.log(
        `${result.passed ? 'PASS' : 'FAIL'} ${scenario.id}: ${result.error || 'settled and visually closed'}`
      );
    }
  } finally {
    try {
      try {
        agent(['close']);
      } catch (error) {
        if (!String(error.stderr).includes('SESSION_NOT_FOUND')) throw error;
      }
    } finally {
      adb('shell', 'ime', 'set', ime);
      setWindowAnimationScale(windowAnimationScale);
    }
  }
  if (report.results.some((result) => !result.passed)) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
