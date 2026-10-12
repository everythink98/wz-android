export const REVIEW_CHECK_NAMES = [
  ...['nodeseek', 'linuxdo'].flatMap((source) =>
    ['short', 'long-unicode', 'cf-words', 'over-envelope', 'challenge', 'whitespace-title-only-challenge'].map(
      (sample) => `webview-${source}-${sample}`
    )
  ),
  ...[
    'deep-details',
    'deep-blockquote',
    'deep-list',
    'deep-callout',
    'linuxdo-deep-reader',
    'nodeseek-deep-terminal',
    'nodeseek-deep-vote-markers',
    'deep-image-metadata',
    'nodeseek-deep-rendered-polls',
    'deep-entity-boundaries',
    'text-index-new-subtrees',
    'nodeseek-duplicate-poll-placeholders',
    'nodeseek-restricted-fallback',
    'body-poll-chain-audit',
    'pending-poll-materialization'
  ].map((sample) => `content-hermes-${sample}`),
  'feed-hermes-unique-candidate-quota-and-buffer',
  ...['nodeseek', 'linuxdo', 'v2ex', 'yaohuo'].flatMap((source) =>
    ['topics', 'replies'].map((kind) => `user-${source}-${kind}-failure-retry-refresh`)
  ),
  'user-race-page-first',
  'user-race-refresh-first',
  'feed-native-host-cold-success',
  'feed-native-host-cold-failure',
  ...['cancel-reopen', 'inactive', 'scope-change', 'unmount'].map((sample) => `verification-core-${sample}`),
  ...['identity', 'epoch', 'source', 'surface'].map((sample) => `write-csrf-${sample}`),
  'write-native-proxy-preparation',
  'write-confirmed-response-after-invalidation',
  ...[
    'storage-retry',
    'permission-error',
    'permission-denied',
    'unmount-late',
    'worker-total-80',
    'worker-total-1',
    'worker-native-failure',
    'worker-store-failure',
    'worker-identity-change',
    'quality-partial',
    'quality-invalid',
    'quality-legacy'
  ].map((sample) => `notification-${sample}`)
];
const expectedChecks = new Set(REVIEW_CHECK_NAMES);

export function completeReviewProofResults(results) {
  return (
    Array.isArray(results) &&
    results.length === expectedChecks.size &&
    new Set(results.map((result) => result?.name)).size === expectedChecks.size &&
    results.every((result) => expectedChecks.has(result?.name) && result.passed === true)
  );
}

export const layouts = [
  'wide-hidden',
  'wide-script',
  'wide-iframe',
  'wide-image-metadata',
  'wide-cloudflare',
  'wide-video',
  'wide-audio',
  'wide-onebox',
  'wide-magic-tabs',
  'wide-ansi-reports',
  'wide-sticker',
  'wide-references',
  'deep-unrelated-links',
  'deep-member-links',
  'deep-floor-links',
  'compiler-span',
  'compiler-div',
  'wide-options',
  'many-forms',
  'deep-many-forms',
  'nested-forms',
  'wide-shell-form-mask',
  'wide-shell-vote-panel',
  'wide-shell-p',
  'nodeseek-nested-replies',
  'linuxdo-nested-math',
  'linuxdo-wide-math',
  'discourse-deep-callout',
  'discourse-deep-wide-callouts',
  'linuxdo-nested-policy',
  'linuxdo-wide-loaded-polls',
  'yaohuo-deep-outside-ordinary',
  'yaohuo-deep-outside-vote',
  'yaohuo-deep-outside-floor',
  'yaohuo-wide-attachments',
  'yaohuo-wide-loaded-poll-copies',
  'yaohuo-nested-loaded-poll-copies',
  'yaohuo-deep-reply',
  'selector-scoped-descendants'
];
const counters = [
  'arrayVisits',
  'arrayCopies',
  'domReads',
  'decodedInputChars',
  'rawTextChars',
  'serializedChars',
  'replaceInputChars',
  'sliceOutputChars',
  'regexInputWork'
];

function completeWorkSamples(checks, expected) {
  const metrics = checks[0]?.metrics;
  const samples = metrics?.samples;
  return (
    checks.length === 1 &&
    checks[0].passed === true &&
    metrics?.workInstrumentation === 'native-array+native-string+real-DOM+decoder-input' &&
    Array.isArray(samples) &&
    samples.length === expected.size &&
    samples.every(
      (sample) =>
        sample &&
        typeof sample.layout === 'string' &&
        Number.isSafeInteger(sample.size) &&
        expected.has(`${sample.layout}:${sample.size}`) &&
        Number.isSafeInteger(sample.inputChars) &&
        sample.inputChars > sample.size &&
        Number.isSafeInteger(sample.fixtureNodes) &&
        sample.fixtureNodes > sample.size &&
        sample.fixtureNodes <= sample.inputChars &&
        Number.isFinite(sample.operationMs) &&
        sample.operationMs >= 0 &&
        counters.every((key) => Number.isSafeInteger(sample[key]) && sample[key] >= 0) &&
        sample.domReads > 0 &&
        sample.arrayVisits + sample.arrayCopies <= sample.fixtureNodes * 512 + 10_000 &&
        sample.domReads <= sample.fixtureNodes * 1024 + 10_000 &&
        sample.decodedInputChars + sample.rawTextChars <= sample.inputChars * 64 + 10_000 &&
        sample.serializedChars <= sample.inputChars * 64 + 10_000 &&
        sample.replaceInputChars <= sample.inputChars * 128 + 10_000 &&
        sample.sliceOutputChars <= sample.inputChars * 64 + 10_000 &&
        sample.regexInputWork <=
          (sample.inputChars + sample.fixtureNodes) * 256 * (1 + Math.ceil(Math.log2(sample.inputChars + 1))) +
            10_000 &&
        sample.outputVerified === true &&
        sample.descriptorsRestored === true
    ) &&
    new Set(samples.map((sample) => `${sample.layout}:${sample.size}`)).size === expected.size
  );
}

export function completeContentChainMetrics(results) {
  if (!Array.isArray(results)) return false;
  const checks = results.filter((result) => result?.name === 'content-hermes-body-poll-chain-audit');
  const expected = new Set(
    layouts.flatMap((layout) =>
      (layout.startsWith('compiler-') ? [2048, 16_384] : [512, 4096]).map((size) => `${layout}:${size}`)
    )
  );
  return checks[0]?.metrics?.codeCopiesVerified === 8 && completeWorkSamples(checks, expected);
}

const entityLayouts = [
  'single-decimal-leading-cut',
  'single-hex-leading-cut',
  'double-decimal-leading-cut',
  'double-hex-leading-cut',
  'single-decimal-trailing-cut',
  'double-decimal-trailing-cut'
];
export const deepWorkLayouts = {
  'nodeseek-deep-vote-markers': ['div-far', 'div-absent', 'p-far', 'p-absent', 'nested-div'],
  'deep-image-metadata': ['plain-text', 'nested-class-meta', 'image-protected', 'split-text', 'unique-text-meta'],
  'nodeseek-deep-rendered-polls': [
    'form-panel-far',
    'form-panel-absent',
    'form-panel-self',
    'shell-empty',
    'shell-text',
    'shell-media'
  ],
  'deep-entity-boundaries': entityLayouts.flatMap((layout) =>
    ['createForumTextIndex', 'sanitizeContentHtmlWithRoot', 'normalizeRenderedNodeSeekPollRoot'].map(
      (operation) => `${layout}:${operation}`
    )
  ),
  'text-index-new-subtrees': entityLayouts.flatMap((layout) =>
    ['root-first', 'leaves-first', 'moved-known'].map((order) => `${layout}:${order}`)
  ),
  'nodeseek-duplicate-poll-placeholders': [
    'duplicate-p-placeholders',
    'nested-div-placeholders',
    'root-sibling-placeholders',
    'wide-anchor-markers',
    'wide-text-markers'
  ],
  'nodeseek-restricted-fallback': [
    'restricted-same-range',
    'unrestricted-same-range',
    'unrestricted-distinct-prefix',
    'amp-prefix-negative',
    'markup-prefix-negative',
    'numeric-prefix-negative',
    'quoted-prefix-negative',
    'script-prefix-negative',
    'numeric-boundary-prefix-negative',
    'interleaved-br-negative',
    'interleaved-br-positive',
    'actual-script-style-negative'
  ]
};

export function completeDeepContentMetrics(results) {
  if (!Array.isArray(results)) return false;
  if (
    !Object.entries(deepWorkLayouts).every(([name, layouts]) => {
      const expected = new Set(layouts.flatMap((layout) => [2048, 16_384].map((size) => `${layout}:${size}`)));
      const checks = results.filter((result) => result?.name === `content-hermes-${name}`);
      return (
        completeWorkSamples(checks, expected) &&
        (!['deep-entity-boundaries', 'text-index-new-subtrees'].includes(name) ||
          checks[0].metrics.samples.every((sample) => sample.decodedInputChars > 0 && sample.regexInputWork > 0)) &&
        (name !== 'nodeseek-restricted-fallback' ||
          checks[0].metrics.samples.every((sample) => sample.replaceInputChars > 0))
      );
    })
  )
    return false;
  for (const [name, key, expected] of [
    [
      'text-index-new-subtrees',
      'name',
      ['multiple-new-trees', 'detached-tree', 'replace-root-child', 'br-hand-descendants', 'held-range-tape-immutable']
    ],
    ['nodeseek-duplicate-poll-placeholders', 'count', [1, 2, 2048, 16_384]]
  ]) {
    const aux = results.find((result) => result.name === `content-hermes-${name}`).metrics.auxOutputs;
    if (
      !Array.isArray(aux) ||
      aux.length !== expected.length ||
      new Set(aux.map((output) => output?.[key])).size !== expected.length ||
      !aux.every((output) => output?.outputVerified === true && expected.includes(output[key]))
    )
      return false;
  }
  return true;
}

export function completePendingPollMetrics(results) {
  if (!Array.isArray(results)) return false;
  const checks = results.filter((result) => result?.name === 'content-hermes-pending-poll-materialization');
  const metrics = checks[0]?.metrics;
  return (
    checks.length === 1 &&
    checks[0].passed === true &&
    metrics?.inputChars === 512 * 1024 &&
    metrics.pollCount === 20 &&
    metrics.guards === 100 &&
    metrics.creates === 0 &&
    Number.isSafeInteger(metrics.splitInputChars) &&
    metrics.splitInputChars > 0 &&
    Number.isSafeInteger(metrics.sliceOutputChars) &&
    metrics.sliceOutputChars > 0 &&
    metrics.splitInputChars + metrics.sliceOutputChars <= metrics.inputChars * 6 + 10_000 &&
    Number.isFinite(metrics.operationMs) &&
    metrics.operationMs >= 0 &&
    metrics.outputVerified === true &&
    metrics.descriptorsRestored === true
  );
}
