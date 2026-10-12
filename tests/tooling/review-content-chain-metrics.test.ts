import { describe, expect, it } from 'vitest';
import { parseHtml } from '../../src/domain/forum/html';
import { createContentWorkSample, measureContentWork } from '../../dev/review-remediation-proof/contentChainProof';
import {
  completeContentChainMetrics,
  completeDeepContentMetrics,
  completePendingPollMetrics,
  completeReviewProofResults,
  REVIEW_CHECK_NAMES,
  deepWorkLayouts,
  layouts
} from '../../scripts/review-content-chain-metrics.mjs';

function workSample(layout: string, size: number) {
  return {
    layout,
    size,
    inputChars: size * 20,
    fixtureNodes: size + 2,
    operationMs: 1,
    arrayVisits: size * 8,
    arrayCopies: size * 4,
    domReads: size * 16,
    decodedInputChars: size,
    rawTextChars: size,
    serializedChars: size * 20,
    replaceInputChars: size * 40,
    sliceOutputChars: size * 20,
    regexInputWork: size * 16,
    outputVerified: true,
    descriptorsRestored: true
  };
}

function receipt() {
  return [
    {
      name: 'content-hermes-body-poll-chain-audit',
      passed: true,
      metrics: {
        workInstrumentation: 'native-array+native-string+real-DOM+decoder-input',
        codeCopiesVerified: 8,
        samples: layouts.flatMap((layout) =>
          (layout.startsWith('compiler-') ? [2048, 16_384] : [512, 4096]).map((size) => workSample(layout, size))
        )
      }
    }
  ];
}

function deepReceipt() {
  return Object.entries(deepWorkLayouts).map(([name, variants]) => ({
    name: `content-hermes-${name}`,
    passed: true,
    metrics: {
      workInstrumentation: 'native-array+native-string+real-DOM+decoder-input',
      samples: variants.flatMap((layout) => [2048, 16_384].map((size) => workSample(layout, size))),
      auxOutputs:
        name === 'text-index-new-subtrees'
          ? [
              'multiple-new-trees',
              'detached-tree',
              'replace-root-child',
              'br-hand-descendants',
              'held-range-tape-immutable'
            ].map((name) => ({ name, outputVerified: true }))
          : [1, 2, 2048, 16_384].map((count) => ({ count, outputVerified: true }))
    }
  }));
}

describe('body and poll chain device work receipts', () => {
  it.each([false, true])(
    'counts cached regex and attribute work and restores native descriptors after throw=%s',
    (throws) => {
      const html = `<div data-probe="yes">${'cache'.repeat(100)}</div>`;
      const root = parseHtml(html);
      const node = root.querySelector('div')!;
      const cached = node.text;
      const sample = createContentWorkSample('native-observer', 1, html, root);
      const originals = (
        [
          [String.prototype, ['replace', 'slice']],
          [Array.prototype, ['filter', 'map', 'find', 'findIndex', 'some', 'every', 'flatMap', 'slice', 'flat']],
          [RegExp.prototype, ['exec', 'test']]
        ] satisfies [object, string[]][]
      ).flatMap(([prototype, keys]) =>
        keys.map((key) => ({ prototype, key, descriptor: Object.getOwnPropertyDescriptor(prototype, key) }))
      );
      const run = () =>
        measureContentWork(
          sample,
          () => {
            const before = { dom: sample.domReads, regex: sample.regexInputWork };
            for (let index = 0; index < 4; index++) {
              node.getAttribute('data-probe');
              /absent/.test(cached);
              /absent/.exec(cached);
            }
            if (throws) throw new Error('probe task failed');
            return { dom: sample.domReads - before.dom, regex: sample.regexInputWork - before.regex };
          },
          root
        );
      if (throws) expect(run).toThrow('probe task failed');
      else expect(run()).toEqual({ dom: sample.domReads, regex: sample.regexInputWork });
      expect(sample.domReads).toBeGreaterThanOrEqual(4);
      expect(sample.regexInputWork).toBeGreaterThanOrEqual(cached.length * 8);
      expect(sample.descriptorsRestored).toBe(true);
      for (const { prototype, key, descriptor } of originals) {
        const current = Object.getOwnPropertyDescriptor(prototype, key);
        for (const field of ['value', 'get', 'set'] as const) expect(current?.[field]).toBe(descriptor?.[field]);
      }
    }
  );
  it('requires each known business check exactly once with a boolean pass', () => {
    const results = REVIEW_CHECK_NAMES.map((name) => ({ name, passed: true }));
    expect(completeReviewProofResults(results)).toBe(true);
    expect(completeReviewProofResults(results.slice(1))).toBe(false);
    for (const invalid of [
      { name: 'unexpected-legacy-name', passed: true },
      { ...results[0], passed: 'passed' },
      results[1]
    ])
      expect(completeReviewProofResults([invalid, ...results.slice(1)])).toBe(false);
  });
  it('requires exact materialization output, no remote creation, identity guards and linear string work', () => {
    const valid = {
      name: 'content-hermes-pending-poll-materialization',
      passed: true,
      metrics: {
        inputChars: 524_288,
        pollCount: 20,
        guards: 100,
        creates: 0,
        splitInputChars: 524_288,
        sliceOutputChars: 524_288,
        operationMs: 1,
        outputVerified: true,
        descriptorsRestored: true
      }
    };
    expect(completePendingPollMetrics([valid])).toBe(true);
    for (const change of [
      { creates: 1 },
      { guards: 99 },
      { outputVerified: false },
      { descriptorsRestored: false },
      { pollCount: 19 },
      { splitInputChars: NaN },
      { sliceOutputChars: Infinity },
      { splitInputChars: -1 },
      { sliceOutputChars: 0.5 },
      { splitInputChars: 4_000_000 }
    ]) {
      expect(completePendingPollMetrics([{ ...valid, metrics: { ...valid.metrics, ...change } }])).toBe(false);
    }
    expect(completePendingPollMetrics([])).toBe(false);
    expect(completePendingPollMetrics([valid, valid])).toBe(false);
    expect(completePendingPollMetrics([{ ...valid, passed: false }])).toBe(false);
  });
  it('accepts complete two-size matrices with every decoder operation and subtree order', () => {
    expect(completeContentChainMetrics(receipt())).toBe(true);
    const results = deepReceipt();
    expect(results).toHaveLength(7);
    expect(new Set(results.flatMap((check) => check.metrics.samples.map(({ size }) => size)))).toEqual(
      new Set([2048, 16_384])
    );
    expect(new Set(deepWorkLayouts['deep-entity-boundaries'].map((layout) => layout.split(':')[1]))).toEqual(
      new Set(['createForumTextIndex', 'sanitizeContentHtmlWithRoot', 'normalizeRenderedNodeSeekPollRoot'])
    );
    expect(new Set(deepWorkLayouts['text-index-new-subtrees'].map((layout) => layout.split(':')[1]))).toEqual(
      new Set(['root-first', 'leaves-first', 'moved-known'])
    );
    expect(completeDeepContentMetrics(results)).toBe(true);
  });
  it.each([
    'arrayVisits',
    'arrayCopies',
    'domReads',
    'decodedInputChars',
    'rawTextChars',
    'serializedChars',
    'replaceInputChars',
    'sliceOutputChars',
    'regexInputWork'
  ] as const)('rejects excessive or invalid %s work', (key) => {
    for (const value of [Number.MAX_SAFE_INTEGER, -1, NaN, Infinity, 0.5]) {
      const results = receipt();
      results[0].metrics.samples[0][key] = value;
      expect(completeContentChainMetrics(results)).toBe(false);
      const deep = deepReceipt();
      deep[0].metrics.samples[0][key] = value;
      expect(completeDeepContentMetrics(deep)).toBe(false);
    }
  });
  it('rejects missing, duplicate, skipped and unverified samples', () => {
    expect(completeContentChainMetrics([{ name: 'content-hermes-body-poll-chain-audit', passed: true }])).toBe(false);
    const missing = receipt();
    missing[0].metrics.samples.pop();
    const duplicate = receipt();
    duplicate[0].metrics.samples[1] = duplicate[0].metrics.samples[0];
    const failed = receipt();
    failed[0].passed = false;
    const unverified = receipt();
    unverified[0].metrics.samples[0].outputVerified = false;
    const unrestored = receipt();
    unrestored[0].metrics.samples[0].descriptorsRestored = false;
    const invalidCode = receipt();
    invalidCode[0].metrics.codeCopiesVerified = 3;
    const unobserved = receipt();
    unobserved[0].metrics.samples[0].domReads = 0;
    for (const results of [
      missing,
      duplicate,
      failed,
      unverified,
      unrestored,
      invalidCode,
      unobserved,
      [...receipt(), ...receipt()]
    ]) {
      expect(completeContentChainMetrics(results)).toBe(false);
    }
    for (const { create, validate } of [
      { create: receipt, validate: completeContentChainMetrics },
      { create: deepReceipt, validate: completeDeepContentMetrics }
    ]) {
      for (const key of ['size', 'layout'] as const) {
        const results = create();
        const sample = results[0].metrics.samples[0];
        Object.assign(sample, key === 'size' ? { size: String(sample.size) } : { layout: [sample.layout] });
        expect(validate(results)).toBe(false);
      }
    }
  });
  it('rejects missing or duplicate deep checks, samples and auxiliary output', () => {
    const valid = deepReceipt();
    expect(completeDeepContentMetrics(valid.slice(1))).toBe(false);
    expect(completeDeepContentMetrics([...valid, valid[0]])).toBe(false);
    const auxIndexes = ['text-index-new-subtrees', 'nodeseek-duplicate-poll-placeholders'].map((name) =>
      valid.findIndex((check) => check.name === `content-hermes-${name}`)
    );
    for (const index of [0, ...auxIndexes]) {
      const missing = deepReceipt();
      missing[index].metrics.samples.pop();
      const duplicate = deepReceipt();
      duplicate[index].metrics.samples[1] = duplicate[index].metrics.samples[0];
      expect(completeDeepContentMetrics(missing)).toBe(false);
      expect(completeDeepContentMetrics(duplicate)).toBe(false);
    }
    for (const index of auxIndexes) {
      const missing = deepReceipt();
      missing[index].metrics.auxOutputs.pop();
      const duplicate = deepReceipt();
      duplicate[index].metrics.auxOutputs[1] = duplicate[index].metrics.auxOutputs[0];
      const unverified = deepReceipt();
      unverified[index].metrics.auxOutputs[0].outputVerified = false;
      for (const results of [missing, duplicate, unverified]) expect(completeDeepContentMetrics(results)).toBe(false);
    }
    for (const patch of [
      { operationMs: NaN },
      { domReads: 0 },
      { descriptorsRestored: false },
      { outputVerified: false }
    ]) {
      const results = deepReceipt();
      Object.assign(results[0].metrics.samples[0], patch);
      expect(completeDeepContentMetrics(results)).toBe(false);
    }
    for (const name of ['deep-entity-boundaries', 'text-index-new-subtrees']) {
      for (const key of ['decodedInputChars', 'regexInputWork'] as const) {
        const results = deepReceipt();
        const check = results.find((check) => check.name === `content-hermes-${name}`)!;
        check.metrics.samples[0][key] = 0;
        expect(completeDeepContentMetrics(results)).toBe(false);
      }
    }
    const unobservedFallback = deepReceipt();
    unobservedFallback.find(
      (check) => check.name === 'content-hermes-nodeseek-restricted-fallback'
    )!.metrics.samples[0].replaceInputChars = 0;
    expect(completeDeepContentMetrics(unobservedFallback)).toBe(false);
    const failed = deepReceipt();
    failed[0].passed = false;
    expect(completeDeepContentMetrics(failed)).toBe(false);
  });
});
