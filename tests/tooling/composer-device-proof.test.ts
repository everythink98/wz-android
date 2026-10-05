import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  assertComposerExpressionGeometry,
  assertComposerExpressionInsets
} from '../../scripts/composer-expression-geometry.mjs';
import {
  assertComposerClosed,
  assertComposerFullscreen,
  assertTopicCreationKeyboardGeometry,
  assertComposerReceipt,
  composerSafeTop,
  composerImeStressLimits,
  assertComposerImeEdit,
  composerImeEditEvidence,
  composerImeInput,
  injectComposerImeInput,
  captureComposerImeDom,
  assertComposerImeDom,
  composerCases,
  assertTopicCreationReceipt,
  assertTopicEditReceipt,
  assertComposerProofAvd,
  composerReplayArgs,
  isTopicCreationReceiptSettled,
  isTopicCreationViewReady,
  recordComposerFailure,
  topicCreationCases
} from '../../scripts/run-composer-device-proof.mjs';

describe('composer device evidence', () => {
  it('checks the actual native picker bottom against the real IME and navigation frames', () => {
    const insets =
      'type=ime frame=[0,1517][1080,2400] visible=true\n' + 'type=navigationBars frame=[0,2274][1080,2400]';
    const nodes = [{ identifier: 'structured-composer-editor-frame', rect: { y: 521, height: 997 } }];
    expect(() => assertComposerExpressionInsets(nodes, insets, true)).not.toThrow();
    expect(() => assertComposerExpressionInsets(nodes, insets, false)).toThrow('not settled');
    expect(() =>
      assertComposerExpressionInsets([{ ...nodes[0], rect: { y: 1200, height: 997 } }], insets, true)
    ).toThrow('covers');
  });
  it('rejects squeezed expression grids, moving tabs and images leaking above the grid', () => {
    const rect = (top: number, height: number) => ({ top, bottom: top + height, width: 400, height });
    const value = {
      runtime: rect(0, 380),
      header: rect(0, 50),
      navigation: rect(0, 50),
      body: rect(50, 330),
      close: { width: 48, height: 48 },
      rowCapacity: 4,
      itemHeight: 60,
      navigationInScroller: false,
      leakedGrid: false,
      missingLoadingFeedback: false,
      editorHidden: true
    };
    expect(() => assertComposerExpressionGeometry(value)).not.toThrow();
    expect(() => assertComposerExpressionGeometry({ ...value, missingLoadingFeedback: true })).toThrow(
      'loading feedback'
    );
    expect(() => assertComposerExpressionGeometry({ ...value, rowCapacity: 1 })).toThrow('complete rows');
    expect(() => assertComposerExpressionGeometry({ ...value, navigationInScroller: true })).toThrow('overlap');
    expect(() => assertComposerExpressionGeometry({ ...value, leakedGrid: true })).toThrow('overlap');
    expect(() => assertComposerExpressionGeometry({ ...value, editorHidden: false })).toThrow('shares');
    expect(() => assertComposerExpressionGeometry({ ...value, header: rect(105, 50) })).toThrow('fill');
    expect(() => assertComposerExpressionGeometry({ ...value, navigation: rect(8, 50) }, value)).toThrow('moves');
    expect(() => assertComposerExpressionGeometry({ ...value, close: { width: 40, height: 40 } })).toThrow('touch');
    const tall = {
      ...value,
      runtime: rect(0, 800),
      header: rect(440, 50),
      body: rect(490, 310),
      editor: rect(0, 440),
      editorHidden: false,
      editorAccessible: true
    };
    expect(() => assertComposerExpressionGeometry(tall)).not.toThrow();
    expect(() => assertComposerExpressionGeometry({ ...tall, editorHidden: true })).toThrow('draft preview');
    expect(() => assertComposerExpressionGeometry({ ...tall, header: rect(0, 50) })).toThrow('draft preview');
  });
  it('recognizes a base-URL composer whose DevTools URL is about:blank and rejects unrelated pages', () => {
    const dom = new JSDOM('<base href="https://composer.local/"><div class="ProseMirror composer-document"></div>');
    try {
      const evidence = captureComposerImeDom(dom.window.document, 'read');
      expect(evidence.url).toBe('about:blank');
      expect(evidence.baseURI).toBe('https://composer.local/');
      expect(() => assertComposerImeDom(evidence)).not.toThrow();
      expect(() => assertComposerImeDom({ ...evidence, baseURI: 'https://example.com/' })).toThrow(
        'not the initialized'
      );
      expect(() => assertComposerImeDom({ ...evidence, editors: [] })).toThrow('not the initialized');
    } finally {
      dom.window.close();
    }
  });
  it('preserves 20 rounds of 512 distinguishable ASCII characters across fresh bounded native input batches', () => {
    const calls: string[][] = [];
    const adb = (...args: string[]) => {
      calls.push(args);
    };
    for (let cycle = 1; cycle <= 20; cycle += 1) {
      const input = composerImeInput(cycle, 512);
      expect(input).toMatch(/^[a-z0-9]{512}$/);
      expect(input).toBe(composerImeInput(cycle, 512));
      expect(input).not.toBe(composerImeInput(cycle + 1, 512));
      const start = calls.length;
      expect(injectComposerImeInput(adb, input)).toHaveLength(8);
      const batches = calls.slice(start);
      expect(batches.every((args) => args.slice(0, 3).join(' ') === 'shell input text')).toBe(true);
      expect(batches.map((args) => args[3]).join('')).toBe(input);
      expect(batches.every((args) => args[3].length === 64)).toBe(true);
      expect(new Set(batches.map((args) => args[3])).size).toBe(8);
    }
    expect(calls).toHaveLength(160);
    let attempts = 0;
    expect(() =>
      injectComposerImeInput(
        () => {
          attempts += 1;
          if (attempts === 2) throw new Error('Native input failed');
        },
        composerImeInput(1, 512)
      )
    ).toThrow('Native input failed');
    expect(attempts).toBe(2);
  });
  it('reports missing characters without claiming repeated filler identifies old-text deletion', () => {
    const before = 'Local ' + 'x'.repeat(2589 - 13) + 'r sent.';
    const input = 'wzime006'.padEnd(512, 'x');
    const after = before.slice(0, 2371) + input + before.slice(2582);
    expect(before).toHaveLength(2589);
    expect(after).toHaveLength(2890);
    expect(() => assertComposerImeEdit(before, after, input)).toThrow('preserve the complete');
    expect(composerImeEditEvidence(before, after, input)).toEqual({
      expectedChars: 3101,
      actualChars: 2890,
      inputOccurrences: 1,
      exactInsertion: false,
      comparison: 'Remove one full input match; repeated characters cannot identify which copy was lost',
      commonPrefix: 2371,
      unmatchedBefore: 'x'.repeat(211),
      unmatchedAfter: ''
    });
    expect(composerImeEditEvidence(before, before + input, input).exactInsertion).toBe(true);
    expect(composerImeEditEvidence(before, before + input + input, input).inputOccurrences).toBe(2);
  });
  it('observes the selected replacement and bounded native event history without moving the caret or changing text', () => {
    const dom = new JSDOM('<div class="ProseMirror" contenteditable="true">keep old text</div>', {
      url: 'https://composer.local/'
    });
    try {
      const document = dom.window.document;
      const editor = document.querySelector('.ProseMirror')!;
      const range = document.createRange();
      range.setStart(editor.firstChild!, 5);
      range.setEnd(editor.firstChild!, 8);
      document.getSelection()!.addRange(range);
      const before = captureComposerImeDom(document, 'start');
      expect(before.selection).toMatchObject({ collapsed: false, anchor: 5, focus: 8, text: 'old' });
      for (const type of ['keydown', 'keyup'])
        editor.dispatchEvent(new dom.window.KeyboardEvent(type, { bubbles: true, key: 'a' }));
      for (let index = 0; index < 100; index += 1)
        editor.dispatchEvent(
          new dom.window.InputEvent('beforeinput', {
            bubbles: true,
            inputType: 'insertText',
            data: `key${index}`,
            isComposing: index === 0
          })
        );
      const after = captureComposerImeDom(document, 'read');
      expect(after.editors[0].text).toBe('keep old text');
      expect(after.selection).toEqual(before.selection);
      expect(after.events).toMatchObject({
        count: 102,
        counts: { keydown: 1, keyup: 1, beforeinput: 100 },
        printableKeyChars: { keydown: 1, keyup: 1 },
        inputTypes: { 'beforeinput:insertText': 100 },
        dataChars: { beforeinput: 490 },
        anomalyCount: 100
      });
      expect(after.events?.anomalies).toHaveLength(16);
      expect(after.events?.first).toHaveLength(16);
      expect(after.events?.last).toHaveLength(16);
      expect(after.events?.first[0]).toMatchObject({
        type: 'beforeinput',
        inputType: 'insertText',
        data: 'key0',
        composing: true,
        selection: { text: 'old', collapsed: false }
      });
      expect(after.events?.last.at(-1)).toMatchObject({ data: 'key99' });
      editor.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true }));
      const stopped = captureComposerImeDom(document, 'stop');
      expect(stopped.events?.count).toBe(103);
      expect(stopped.events?.last.at(-1)).toMatchObject({ type: 'input' });
      editor.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true }));
      expect(captureComposerImeDom(document, 'stop').events).toBeNull();
    } finally {
      dom.window.close();
    }
  });
  it('bounds repeated native input and refuses loss or duplication anywhere in the WebView document', () => {
    expect(composerImeStressLimits({})).toEqual({ cycles: 20, chars: 512, timeoutMs: 1200000 });
    expect(composerImeStressLimits({ 'ime-cycles': '3', 'ime-chars': '1024', 'ime-timeout-minutes': '5' })).toEqual({
      cycles: 3,
      chars: 1024,
      timeoutMs: 300000
    });
    for (const values of [
      { 'ime-cycles': '0' },
      { 'ime-cycles': '101' },
      { 'ime-cycles': '1.5' },
      { 'ime-chars': '31' },
      { 'ime-chars': '4097' },
      { 'ime-chars': 'NaN' },
      { 'ime-timeout-minutes': '0' },
      { 'ime-timeout-minutes': '61' }
    ])
      expect(() => composerImeStressLimits(values)).toThrow();
    const before = 'Local draft remains intact.';
    const input = 'wzime001xxxxxxxx';
    for (const position of [0, 10, before.length]) {
      const after = before.slice(0, position) + input + before.slice(position);
      expect(() => assertComposerImeEdit(before, after, input)).not.toThrow();
    }
    for (const after of [before, before + input + input, before.slice(1) + input, before.toUpperCase() + input])
      expect(() => assertComposerImeEdit(before, after, input)).toThrow();
    expect(() => assertComposerImeEdit(before, before, '')).toThrow();
  });
  it('requires edit receipts to preserve original body and every unrelated draft', () => {
    const receipt = {
      token: 'edit',
      buildId: 'build',
      isHermes: true,
      isDev: false,
      topic: {
        ready: true,
        blockedRequests: 0,
        route: 'MainTabs',
        drafts: { nodeseek: { retained: true } },
        attempts: {},
        edit: {
          exists: false,
          bodyExact: true,
          otherDraftRetained: true,
          status: 'saved',
          writes: 1,
          blockedRequests: 0
        }
      }
    };
    expect(() => assertTopicEditReceipt(receipt, { token: 'edit', buildId: 'build', status: 'saved' })).not.toThrow();
    const repeated = { ...receipt, topic: { ...receipt.topic, edit: { ...receipt.topic.edit, writes: 2 } } };
    expect(() =>
      assertTopicEditReceipt(repeated, { token: 'edit', buildId: 'build', status: 'saved', writes: 2 })
    ).not.toThrow();
    expect(() =>
      assertTopicEditReceipt(receipt, { token: 'edit', buildId: 'build', status: 'saved', writes: 2 })
    ).toThrow();
    for (const patch of [
      { bodyExact: false },
      { otherDraftRetained: false },
      { writes: 2 },
      { blockedRequests: 1 },
      { exists: true }
    ])
      expect(() =>
        assertTopicEditReceipt(
          { ...receipt, topic: { ...receipt.topic, edit: { ...receipt.topic.edit, ...patch } } },
          { token: 'edit', buildId: 'build', status: 'saved' }
        )
      ).toThrow();
  });
  it('persists the original failure before best-effort evidence and retains capture errors without retrying', () => {
    const result = { passed: true, error: '', detail: '', evidenceError: '' };
    const saved: (typeof result)[] = [];
    const operations: string[] = [];
    recordComposerFailure({
      result,
      error: { message: 'Original agent failure', stderr: 'original stderr' },
      persist: () => {
        operations.push('persist');
        saved.push({ ...result });
      },
      evidence: {
        receipt: () => {
          operations.push('receipt');
          throw new Error('ADB device offline');
        },
        screenshot: () => {
          operations.push('screenshot');
          throw new Error('screencap disconnected');
        }
      }
    });
    expect(operations).toEqual(['persist', 'receipt', 'screenshot', 'persist']);
    expect(saved[0]).toMatchObject({
      passed: false,
      error: 'Original agent failure',
      detail: 'original stderr',
      evidenceError: ''
    });
    expect(result).toMatchObject({
      passed: false,
      error: 'Original agent failure',
      detail: 'original stderr',
      evidenceError: 'receipt: ADB device offline\nscreenshot: screencap disconnected'
    });
    expect(saved[1]).toEqual(result);
  });
  it('passes the exact allowlisted device into replay context variables', () => {
    for (const avd of ['WZ_ComposerInsets_0916', 'WZ_TopicCreation_Test_API35']) {
      const args = composerReplayArgs({ name: 'submit', avd, submitLabel: '发送回复' });
      expect(args).toContain(`PROOF_DEVICE=${avd}`);
      expect(args.slice(0, 2)).toEqual(['replay', 'dev/composer-proof/submit.ad']);
      expect(args).toContain('SUBMIT_LABEL=发送回复');
    }
    expect(() => composerReplayArgs({ name: 'open', avd: 'main', submitLabel: '发送回复' })).toThrow(
      'Refusing non-proof device'
    );
  });
  it('waits for request and SQLite observations to agree without hiding duplicate dispatch', () => {
    const receipt = { topic: { writes: 0, attempts: { nodeseek: 'unknown' }, route: 'TopicComposer' } };
    expect(isTopicCreationReceiptSettled(receipt, 'nodeseek', 'unknown')).toBe(false);
    for (const writes of [1, 2])
      expect(isTopicCreationReceiptSettled({ topic: { ...receipt.topic, writes } }, 'nodeseek', 'unknown')).toBe(true);
    expect(isTopicCreationReceiptSettled({ topic: { ...receipt.topic, writes: 1 } }, 'nodeseek', 'posted')).toBe(false);
  });
  it('waits for the native editor initialization and draft restoration states to disappear', () => {
    const title = { label: 'Local nodeseek topic proof' };
    const toolbar = { label: '发帖常用工具栏' };
    expect(isTopicCreationViewReady([title, toolbar], 'nodeseek')).toBe(true);
    expect(isTopicCreationViewReady([title], 'nodeseek')).toBe(false);
    expect(isTopicCreationViewReady([title], 'linuxdo')).toBe(false);
    for (const label of ['正在初始化编辑器…', '编辑器初始化中', '正在恢复草稿…', '正在读取原站发帖规则…'])
      expect(isTopicCreationViewReady([title, toolbar, { label }], 'nodeseek')).toBe(false);
  });
  it('accepts only the two exact isolated proof AVD names', () => {
    for (const name of ['WZ_ComposerInsets_0916', 'WZ_TopicCreation_Test_API35'])
      expect(() => assertComposerProofAvd(name)).not.toThrow();
    for (const name of [
      '',
      'emulator-5554',
      'Pixel_8_API_35',
      'WZ_TopicCreation_Test_API35_copy',
      'WZ_TopicCreation_Test_API35 ',
      'wz_topiccreation_test_api35',
      'WZ_ComposerInsets_0916_backup'
    ])
      expect(() => assertComposerProofAvd(name)).toThrow('Refusing non-proof device');
  });
  const expected = { token: 'run-a', buildId: 'build-a', closed: true };
  const receipt = {
    ...expected,
    isHermes: true,
    isDev: false,
    visible: false,
    content: '',
    busy: false,
    keyboardShown: false,
    confirmations: 1,
    requests: 1
  };
  const screen = { width: 10, height: 20, data: Buffer.alloc(10 * 20 * 4, 255) };
  it('requires the current run, Release Hermes, one confirmation and complete settlement', () => {
    expect(() => assertComposerReceipt(receipt, expected)).not.toThrow();
    for (const change of [
      { token: 'old' },
      { buildId: 'old' },
      { isDev: true },
      { isHermes: false },
      { visible: true },
      { content: 'old' },
      { busy: true },
      { keyboardShown: true },
      { confirmations: 0 },
      { requests: 2 }
    ])
      expect(() => assertComposerReceipt({ ...receipt, ...change }, expected)).toThrow();
  });
  it('rejects visible native residue or a remaining backdrop independently of settlement', () => {
    expect(() => assertComposerClosed([], screen, screen)).not.toThrow();
    expect(() =>
      assertComposerClosed([{ identifier: 'composer-bottom-sheet', rect: { height: 9 } }], screen, screen)
    ).toThrow();
    expect(() => assertComposerClosed([], screen, { ...screen, data: Buffer.alloc(screen.data.length, 0) })).toThrow();
  });
  it('rejects a top gap, unsafe toolbar or discontinuous status-bar background', () => {
    const nodes = [
      { identifier: 'composer-bottom-sheet', rect: { y: 0 } },
      { label: '收起回复', rect: { y: 3 } }
    ];
    expect(() => assertComposerFullscreen(nodes, screen, 3)).not.toThrow();
    expect(() => assertComposerFullscreen([{ ...nodes[0], rect: { y: 1 } }, nodes[1]], screen, 3)).toThrow();
    expect(() => assertComposerFullscreen(nodes, screen, 4)).toThrow();
    const image = { ...screen, data: Buffer.from(screen.data) };
    image.data[(1 * image.width + image.width - 2) * 4] = 0;
    expect(() => assertComposerFullscreen(nodes, image, 3)).toThrow();
  });
  it('uses effective cutout Insets and rejects an enabled overlay without a larger safe area', () => {
    const flat = 'type=statusBars frame=[0,0][1080,63]\nmDisplayCutout=DisplayCutout{insets=Rect(0, 0 - 0, 0)}';
    expect(composerSafeTop(flat)).toBe(63);
    expect(() => composerSafeTop(flat, true)).toThrow('no effective safe inset');
    expect(composerSafeTop(flat.replace('Rect(0, 0 -', 'Rect(0, 180 -'), true)).toBe(180);
    expect(composerSafeTop(flat.replace('[1080,63]', '[1080,180]').replace('Rect(0, 0 -', 'Rect(0, 180 -'), true)).toBe(
      180
    );
    expect(() => composerSafeTop('')).toThrow('geometry unavailable');
  });
  it('requires the topic footer and safe area to follow actual IME visibility after a native panel closes', () => {
    const windowInsets = (visible: boolean) =>
      `mCurrentFocus=Window{fixture u0 com.wz.reader/com.wz.reader.MainActivity}
      mDisplayFrame=Rect(0, 0 - 1080, 2400)
      InsetsSource id=3 type=ime frame=[0,1517][1080,2400] visible=${visible}
      InsetsSource id=4 type=navigationBars frame=[0,2337][1080,2400] visible=true`;
    const nodes = (height: number, footerBottom: number, footerHeight = 157) => [
      { identifier: 'create-topic-safe-area', rect: { x: 0, y: 0, width: 1080, height } },
      {
        label: '发帖常用工具栏',
        rect: { x: 0, y: footerBottom - footerHeight, width: 1080, height: footerHeight }
      },
      {
        identifier: 'structured-composer-editor-frame',
        rect: { x: 0, y: 400, width: 1080, height: footerBottom - 400 }
      },
      { label: '图片', rect: { x: 160, y: footerBottom - 136, width: 126, height: 126 } }
    ];
    expect(() => assertTopicCreationKeyboardGeometry(nodes(2400, 2337), windowInsets(false), false)).not.toThrow();
    expect(() => assertTopicCreationKeyboardGeometry(nodes(2400, 2337, 240), windowInsets(false), false)).not.toThrow();
    expect(() => assertTopicCreationKeyboardGeometry(nodes(1580, 1517), windowInsets(true), true)).not.toThrow();
    // Actual failing Android geometry: IME hidden while the old 819px padding remains.
    expect(() => assertTopicCreationKeyboardGeometry(nodes(1581, 1518), windowInsets(false), false)).toThrow(
      'safe area'
    );
    expect(() => assertTopicCreationKeyboardGeometry(nodes(2400, 1518), windowInsets(false), false)).toThrow('footer');
    expect(() => assertTopicCreationKeyboardGeometry(nodes(1580, 1517), windowInsets(true), false)).toThrow(
      'IME visibility'
    );
    expect(() => assertTopicCreationKeyboardGeometry(nodes(2400, 2337), '', false)).toThrow('geometry unavailable');
    expect(() => assertTopicCreationKeyboardGeometry([], windowInsets(false), false)).toThrow('safe area');
    const compressed = nodes(1580, 1517);
    compressed[2].rect.y = compressed[3].rect.y - 60;
    expect(() => assertTopicCreationKeyboardGeometry(compressed, windowInsets(true), true)).toThrow('editing space');
  });
  it('enumerates all sixteen structured reply success combinations', () => {
    const matrix = composerCases.filter((scenario) =>
      /^(nodeseek|linuxdo)-(rich|source)-(sheet|fullscreen)-(shown|hidden)$/.test(scenario.id)
    );
    expect(matrix).toHaveLength(16);
    expect(new Set(matrix.map((scenario) => scenario.id)).size).toBe(16);
  });
  it('requires durable topic outcomes, one dispatch and independent drafts', () => {
    const expectedTopic = { token: 'run-a', buildId: 'build-a', source: 'linuxdo', status: 'enqueued' };
    const proof = {
      ...receipt,
      topic: {
        ready: true,
        route: 'MainTabs',
        writes: 1,
        blockedRequests: 0,
        attempts: { linuxdo: 'enqueued' },
        drafts: { nodeseek: { retained: true }, linuxdo: { empty: true }, yaohuo: { retained: true } }
      }
    };
    expect(() => assertTopicCreationReceipt(proof, expectedTopic)).not.toThrow();
    for (const update of [
      { writes: 2 },
      { blockedRequests: 1 },
      { route: 'TopicComposer' },
      { attempts: { linuxdo: 'unknown' } },
      { drafts: { ...proof.topic.drafts, nodeseek: { retained: false } } },
      { drafts: { ...proof.topic.drafts, linuxdo: { empty: false } } }
    ])
      expect(() =>
        assertTopicCreationReceipt({ ...proof, topic: { ...proof.topic, ...update } }, expectedTopic)
      ).toThrow();
    const unknown = {
      ...proof,
      topic: {
        ...proof.topic,
        route: 'TopicComposer',
        attempts: { linuxdo: 'unknown' },
        drafts: { ...proof.topic.drafts, linuxdo: { retained: true } }
      }
    };
    expect(() => assertTopicCreationReceipt(unknown, { ...expectedTopic, status: 'unknown' })).not.toThrow();
    expect(() => assertTopicCreationReceipt(unknown, { ...expectedTopic, noWrites: true })).toThrow();
  });
  it('covers every creation provider, Yaohuo form kind and durable draft transition', () => {
    expect(topicCreationCases).toHaveLength(20);
    for (const source of ['nodeseek', 'linuxdo', 'yaohuo'])
      for (const outcome of ['success', 'rejected', 'unconfirmed'])
        expect(topicCreationCases).toContainEqual(expect.objectContaining({ source, outcome }));
    for (const stress of ['gift', 'poll', 'resources', 'files', 'switch', 'restart', 'panel-keyboard'])
      expect(topicCreationCases).toContainEqual(expect.objectContaining({ stress }));
  });
  it('requires Yaohuo active multipart fields and refuses dispatch hidden by a process restart', () => {
    const base = {
      ...receipt,
      topic: {
        ready: true,
        route: 'Topic',
        writes: 1,
        blockedRequests: 0,
        attempts: { yaohuo: 'posted' },
        drafts: { nodeseek: { retained: true }, linuxdo: { retained: true }, yaohuo: { empty: true } },
        lastWrite: {
          path: '/bbs/book_view_addfile.aspx',
          fields: { book_title: 1, book_content: 1, book_file: 1, book_file_info: 1, num: 1 }
        }
      }
    };
    const expectedTopic = { token: 'run-a', buildId: 'build-a', source: 'yaohuo', status: 'posted', kind: 'files' };
    expect(() => assertTopicCreationReceipt(base, expectedTopic)).not.toThrow();
    for (const change of [
      { path: '/bbs/book_view_add.aspx' },
      { fields: { ...base.topic.lastWrite.fields, book_file: 0 } },
      { fields: { ...base.topic.lastWrite.fields, vote: 3 } }
    ])
      expect(() =>
        assertTopicCreationReceipt(
          { ...base, topic: { ...base.topic, lastWrite: { ...base.topic.lastWrite, ...change } } },
          expectedTopic
        )
      ).toThrow();
    const restored = {
      ...base,
      topic: { ...base.topic, writes: 0, drafts: { ...base.topic.drafts, yaohuo: { retained: true } }, attempts: {} }
    };
    expect(() =>
      assertTopicCreationReceipt(restored, { token: 'run-a', buildId: 'build-a', noWrites: true })
    ).not.toThrow();
    expect(() =>
      assertTopicCreationReceipt(
        { ...restored, topic: { ...restored.topic, attempts: { yaohuo: 'unknown' } } },
        { token: 'run-a', buildId: 'build-a', noWrites: true }
      )
    ).toThrow();
  });
});
