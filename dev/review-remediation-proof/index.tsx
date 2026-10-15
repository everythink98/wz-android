import '@/platform/diagnostics/diagnosticBootstrap';
import { registerRootComponent } from 'expo';
import { File, Paths } from 'expo-file-system';
import { QueryClientProvider } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Permissions from 'expo-notifications/build/NotificationPermissionsModule';
import * as Notifications from 'expo-notifications';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { findNodeHandle, Linking, NativeModules, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { FlashListRef } from '@shopify/flash-list';
import WebView from 'react-native-webview';
import { HTMLElement } from 'node-html-parser';
import {
  LINUXDO_BROWSER_FETCH_SCRIPT,
  NODESEEK_BROWSER_FETCH_SCRIPT,
  useHiddenBrowserFetchController
} from '@/features/account/useHiddenBrowserFetchController';
import { useUserController } from '@/features/user/useUserController';
import { useNotificationsRuntime } from '@/features/notifications/useNotificationsRuntime';
import { appQueryClient } from '@/platform/query/serverState';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import {
  accountSessionSnapshotFromObservation,
  createAccountSessionSnapshot,
  createAccountSessionViewModel
} from '@/domain/session/siteSessionState';
import { createReadGateway } from '@/sources/readGateway';
import { getFeed } from '@/sources/feedRead';
import { mergeTopics } from '@/domain/forum/feed';
import { accessRequirementLevelValue } from '@/domain/forum/presentation';
import { createForumTextIndex, isRecord, parseForumContentHtml, parseHtml } from '@/domain/forum/html';
import { prepareSanitizedForumContent, requirePreparedForumContent } from '@/domain/forum/topicContentSplit';
import { sanitizeContentHtml, sanitizeContentHtmlWithRoot } from '@/domain/forum/contentSanitizer';
import { getLinuxDoTopic } from '@/sources/linuxdo/reader';
import { normalizeNodeSeekPollPlaceholderNodes, normalizeNodeSeekVoteMarkers } from '@/sources/nodeseek/polls';
import { parseNodeSeekPageDocument } from '@/sources/nodeseek/protocol';
import {
  normalizeRenderedNodeSeekPollRoot,
  parseRenderedNodeSeekTopicHtml,
  prepareNodeSeekForumContent
} from '@/sources/nodeseek/topicParser';
import {
  defaultNotificationState,
  NOTIFICATION_STORAGE_KEY,
  loadNotificationState,
  saveNotificationState,
  recordNotificationSnapshot,
  recordNotificationDelivery,
  clearNotificationSourceForContentDisable,
  resetNotificationSourceIdentity
} from '@/platform/notifications/notificationStore';
import {
  runNotificationBackgroundWorker,
  notificationIdentifiersForIdentity
} from '@/platform/notifications/notificationWorker';
import {
  notificationPermissionGranted,
  presentSourceNotification,
  reconcileSourceNotificationSlots,
  dismissSourceNotificationExact
} from '@/platform/notifications/notificationSystem';
import { diagnosticBuildContext } from '@/platform/diagnostics/nativeDiagnosticJournal';
import { laneFor, userResponses } from '../../tests/fixtures/userActivityEvidence';
import type { Source, Topic } from '@/domain/forum/models';
import { FeedScreen } from '@/features/feed/FeedScreen';
import { useFeedController } from '@/features/feed/useFeedController';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { createTheme } from '@/ui/theme/tokens';
import { useVerificationController } from '@/features/account/useVerificationController';
import type { AccountReconcileResult, LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import { useNetworkProxyRuntime } from '@/platform/network/useNetworkProxyRuntime';
import { withRequestBeforeSend } from '@/platform/network/request';
import { validateWritableSessionTicket, type SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';
import { runLinuxDoAction } from '@/sources/linuxdo/actionClient';
import { buildDiscourseActionRequest } from '@/sources/discourse/actionRequest';
import { AcceptanceProof } from './acceptance';
import { PlatformExportsProof } from './platformExports';
import { verifyNotificationQuality } from './notificationQuality';
import { prepareBackgroundProof } from './background';
import { createContentWorkSample, measureContentWork, verifyContentChain, type ContentWork } from './contentChainProof';
import { verifyPendingPollMaterialization } from './pendingPollProof';

// Isolated developer entry only. Synthetic payloads test boundaries, never upstream protocol claims.
// HTTP fixtures use the supplied fetcher; the platform-export route uses an instrumentation-owned loopback server.
// WebView uses inline documents with no remote resources.
const delay = (ms = 30) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function materializeTextRange(segments: ReturnType<ReturnType<typeof createForumTextIndex>['range']>) {
  return segments.map(({ tape, start, end }) => tape.text.slice(start, end)).join('');
}
async function until(test: () => unknown, message: string) {
  const deadline = Date.now() + 20000;
  while (!test()) {
    if (Date.now() > deadline) throw new Error(message);
    await delay();
  }
}
function deferred() {
  let release: () => void = () => {
    throw new Error('Deferred not initialized');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function HookProbe<T>({ useValue, observe }: { useValue: () => T; observe: (value: T) => void }) {
  const value = useValue();
  useLayoutEffect(() => observe(value));
  return null;
}
type BrowserResult = { html?: string; body?: string; challenge?: boolean; error?: string };
function BrowserProbe({
  source,
  body,
  html,
  observe
}: {
  source: 'nodeseek' | 'linuxdo';
  body: string;
  html?: string;
  observe: (value: BrowserResult) => void;
}) {
  const webview = useRef<WebView>(null);
  const handlers = useHiddenBrowserFetchController({
    completeLinuxDoBrowserFetch: observe,
    completeNodeSeekBrowserFetch: observe
  });
  const script =
    source === 'nodeseek'
      ? NODESEEK_BROWSER_FETCH_SCRIPT.replaceAll('__NODESEEK_BROWSER_FETCH_ID__', '42').replaceAll(
          '__NODESEEK_BROWSER_FETCH_OWNER__',
          '"user"'
        )
      : LINUXDO_BROWSER_FETCH_SCRIPT.replaceAll('__LINUXDO_BROWSER_FETCH_ID__', '42');
  const escaped = body.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return (
    <WebView
      ref={webview}
      style={{ height: 180 }}
      originWhitelist={['*']}
      source={{
        html:
          html ||
          `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'"></head><body><pre>${escaped}</pre></body></html>`,
        baseUrl: source === 'nodeseek' ? 'https://www.nodeseek.com/api/proof' : 'https://linux.do/proof.json'
      }}
      onLoadEnd={() => {
        webview.current?.injectJavaScript(script);
        // NodeSeek explicitly owns repeat-injection suppression; LinuxDo is injected once in production.
        if (source === 'nodeseek') webview.current?.injectJavaScript(script);
      }}
      onMessage={
        source === 'nodeseek' ? handlers.handleNodeSeekBrowserFetchMessage : handlers.handleLinuxDoBrowserFetchMessage
      }
    />
  );
}

async function execute(token: string, mount: (node: ReactNode) => void, status: (text: string) => void) {
  check((await AsyncStorage.getItem('reader-storage-proof-owner')) === 'isolated', 'Refusing unowned device storage');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Uncontrolled network denied by isolated proof');
  };
  const originalNotificationState = await AsyncStorage.getItem(NOTIFICATION_STORAGE_KEY);
  const results: {
    name: string;
    passed: boolean;
    error?: string;
    stack?: string;
    stage?: string;
    metrics?: Record<string, unknown>;
  }[] = [];
  let stage: string | undefined;
  const write = (checkpoint: string) => {
    const file = new File(Paths.cache, 'review-remediation-proof.json');
    file.create({ overwrite: true });
    file.write(
      JSON.stringify({
        ...diagnosticBuildContext(),
        token,
        checkpoint,
        isDev: __DEV__,
        isHermes: 'HermesInternal' in globalThis,
        results
      })
    );
    status(`${checkpoint}: ${results.length} checks`);
  };
  const run = async (name: string, task: () => Promise<void>, metrics?: Record<string, unknown>) => {
    stage = undefined;
    try {
      await task();
      results.push({ name, passed: true, ...(metrics ? { metrics } : {}) });
    } catch (error) {
      results.push({
        name,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error ? { stack: error.stack } : {}),
        ...(stage ? { stage } : {}),
        ...(metrics ? { metrics } : {})
      });
    } finally {
      mount(null);
      await delay(80);
      appQueryClient.clear();
      write('running');
    }
  };
  async function hook<T>(useValue: () => T) {
    let current: T | undefined;
    mount(
      <HookProbe
        useValue={useValue}
        observe={(value) => {
          current = value;
        }}
      />
    );
    await until(() => current !== undefined, 'Hook did not mount');
    return () => {
      check(current !== undefined, 'Missing hook observation');
      return current;
    };
  }
  try {
    for (const source of ['nodeseek', 'linuxdo'] as const) {
      for (const [name, body] of [
        ['short', JSON.stringify({ boundary: '小😀文'.repeat(300) })],
        ['long-unicode', JSON.stringify({ boundary: '中😀文'.repeat(6000), tail: 'complete' })],
        ['cf-words', JSON.stringify({ boundary: 'Just a moment cf-turnstile challenge-platform', tail: 'complete' })],
        ['over-envelope', JSON.stringify({ boundary: 'x'.repeat(900001) })]
      ]) {
        await run(`webview-${source}-${name}`, async () => {
          const messages: BrowserResult[] = [];
          mount(<BrowserProbe source={source} body={body} observe={(value) => messages.push(value)} />);
          await until(() => messages.length > 0, 'WebView bridge did not respond');
          await delay(600);
          check(messages.length === 1, 'Request completed more than once');
          const result = messages[0];
          if (name === 'over-envelope')
            check(Boolean(result.error) && !(result.html || result.body), 'Oversized document was returned as success');
          else
            check(
              !result.error && !result.challenge && (result.html || result.body) === body,
              'JSON body changed or was classified as challenge'
            );
        });
      }
      await run(`webview-${source}-challenge`, async () => {
        const messages: BrowserResult[] = [];
        // Same structural challenge oracle as hidden-browser-scripts; no challenge network is contacted.
        mount(
          <BrowserProbe
            source={source}
            body=""
            html={
              '<html><head><title>Just a moment...</title></head><body><h1>Just a moment...</h1><div id="challenge-running"></div></body></html>'
            }
            observe={(value) => messages.push(value)}
          />
        );
        await until(() => messages.length > 0, 'Challenge bridge did not respond');
        await delay(600);
        check(
          messages.length === 1 && messages[0].challenge && !(messages[0].html || messages[0].body),
          'Challenge reported readable content'
        );
      });
      await run(`webview-${source}-whitespace-title-only-challenge`, async () => {
        const messages: BrowserResult[] = [];
        // NBSP survives document.title's ASCII whitespace normalization; no other challenge signal is present.
        mount(
          <BrowserProbe
            source={source}
            body=""
            html="<html><head><title>&nbsp;Just a moment...&nbsp;</title></head><body>controlled challenge</body></html>"
            observe={(value) => messages.push(value)}
          />
        );
        await until(() => messages.length > 0, 'Whitespace challenge bridge did not respond');
        await delay(600);
        check(
          messages.length === 1 && messages[0].challenge && !(messages[0].html || messages[0].body),
          'Whitespace-only challenge was returned as readable content'
        );
      });
    }
    for (const [kind, opening, closing] of [
      ['details', '<details open><summary>Title</summary>', '</details>'],
      ['blockquote', '<blockquote>', '</blockquote>'],
      ['list', '<ul><li>', '</li></ul>'],
      [
        'callout',
        '<blockquote data-forum-callout="true" data-forum-callout-type="tip"><div class="forum-callout-title">Title</div><div class="forum-callout-content">',
        '</div></blockquote>'
      ]
    ]) {
      await run(`content-hermes-deep-${kind}`, async () => {
        check('HermesInternal' in globalThis, 'Semantic content proof requires Hermes');
        const body =
          '<p>before <a href="https://example.com/link">link</a></p><img src="https://example.com/first.png" alt="first">' +
          '<pre><code>&lt;safe&gt;\ncode</code></pre><table><tr><td>cell</td></tr></table>' +
          '<forum-discourse-poll name="choice"></forum-discourse-poll>' +
          '<img src="https://example.com/second.png" alt="second"><p>after</p>';
        stage = 'before-sanitize';
        const plan = prepareSanitizedForumContent(`${opening.repeat(256)}${body}${closing.repeat(256)}`, {
          baseUrl: 'https://linux.do/t/1',
          polls: [{ name: 'choice', options: [{ id: 'yes', label: 'Yes' }] }],
          role: 'opening',
          source: 'linuxdo',
          topicId: '1',
          transformRoot: () => {
            stage = 'sanitizer-root-transform';
          },
          afterSanitizeRoot: () => {
            stage = 'sanitizer-returned';
          }
        }).contentPlan;
        stage = 'content-plan-returned';
        check(
          plan.rows.every((row) => row.ancestorFrames.length <= 64),
          'Semantic depth exceeded 64'
        );
        check(
          plan.rows.reduce((count, row) => count + row.ancestorFrames.length, 0) <= 16_384,
          'Semantic ancestor references exceeded the budget'
        );
        const first = plan.rows[0];
        check(first?.type === 'richText' && first.html.includes('内容过于复杂'), 'Deep content did not degrade');
        check(
          plan.rows.find((row) => row.type === 'codeBlock')?.text === '<safe>\ncode',
          'Deep fallback changed code text'
        );
        check(
          plan.rows.some((row) => row.type === 'table' && row.html.includes('<td>cell</td>')),
          'Table was lost'
        );
        check(
          plan.rows.filter((row) => row.type === 'poll' && row.poll.name === 'choice').length === 1,
          'Poll was lost or repeated'
        );
        const rendered = plan.rows.flatMap((row) => ('html' in row ? [row.html] : [])).join('');
        check(rendered.includes('https://example.com/link'), 'Safe link was lost');
        const selected = plan.rows
          .flatMap((row) => {
            const token: unknown = JSON.parse(row.selectionToken);
            check(isRecord(token) && Array.isArray(token.owners), 'Invalid selection token');
            return token.owners.map((owner: unknown) => {
              check(isRecord(owner) && typeof owner.text === 'string', 'Invalid selection owner');
              return owner.text;
            });
          })
          .join('\n');
        check(/before link[\s\S]*<safe>\ncode[\s\S]*cell[\s\S]*after/.test(selected), 'Selection order changed');
        const expectedImages = ['https://example.com/first.png', 'https://example.com/second.png'];
        check(
          JSON.stringify(plan.previewImages.map((image) => image.source)) === JSON.stringify(expectedImages),
          'Deep fallback changed the preview catalog'
        );
        check(
          JSON.stringify(
            parseHtml(rendered)
              .querySelectorAll('img, forum-inline-image')
              .map((image) => image.getAttribute('src'))
          ) === JSON.stringify(expectedImages),
          'Deep fallback lost or reordered rendered media'
        );
      });
    }
    await run('content-hermes-linuxdo-deep-reader', async () => {
      const cooked =
        '<blockquote data-forum-callout="true">'.repeat(256) +
        '<ul><li>'.repeat(256) +
        '<p>before</p><pre><code>' +
        '<span>'.repeat(2048) +
        '&lt;safe&gt;\ncode' +
        '</span>'.repeat(2048) +
        '</code></pre><img src="/proof.png"><p>after</p>' +
        '</li></ul>'.repeat(256) +
        '</blockquote>'.repeat(256);
      for (const [role, userDeleted] of [
        ['opening', false],
        ['reply', false],
        ['opening', true]
      ] as const) {
        const post = {
          id: role === 'opening' ? 1 : 2,
          username: 'alice',
          cooked,
          created_at: '2026-10-10T00:00:00.000Z',
          post_number: role === 'opening' ? 1 : 2,
          user_deleted: userDeleted,
          deleted_at: null
        };
        const posts =
          role === 'opening' ? [post] : [{ ...post, id: 1, post_number: 1, cooked: '<p>opening</p>' }, post];
        let requests = 0;
        const detail = await getLinuxDoTopic('1', {
          fetcher: async () => {
            requests++;
            return new Response(
              JSON.stringify({
                id: 1,
                title: 'Synthetic depth',
                slug: 'synthetic',
                created_at: post.created_at,
                posts_count: posts.length,
                categories: [],
                post_stream: { stream: posts.map((entry) => entry.id), posts }
              }),
              { headers: { 'content-type': 'application/json' } }
            );
          }
        });
        const prepared = role === 'opening' ? detail : detail.replies[0];
        check(prepared, 'Deep post was lost');
        const plan = requirePreparedForumContent(prepared.preparedContent, prepared.contentHtml, {
          role,
          source: 'linuxdo',
          topicId: '1'
        });
        check(plan.rows.find((row) => row.type === 'codeBlock')?.text === '<safe>\ncode', 'Reader lost code');
        check(plan.previewImages[0]?.source === 'https://linux.do/proof.png', 'Reader lost media');
        check(
          /before[\s\S]*&lt;safe&gt;[\s\S]*code[\s\S]*after/.test(prepared.contentHtml),
          'Reader reordered content'
        );
        check(requests === 1, 'Reader requested extra data');
      }
    });
    await run('content-hermes-nodeseek-deep-terminal', async () => {
      const html = sanitizeContentHtml(
        '<div class="nsk-magic-tabs"><div class="nsk-magic-tab-title">Report</div>' +
          '<div class="nsk-magic-tab-body"><div class="xterm-rows"><div>' +
          '<span>'.repeat(2048) +
          '<span style="color: #00ff00">&lt;safe&gt;</span>' +
          '</span>'.repeat(2048) +
          '</div><div>after</div></div></div></div>',
        'https://www.nodeseek.com/post-1-1'
      );
      check(html.includes('forum-terminal-report'), 'Deep terminal report was lost');
      check(html.includes('style="color: #00ff00"'), 'Deep terminal style was lost');
      check(/&lt;safe&gt;[\s\S]*after/.test(html), 'Deep terminal text changed');
    });
    const voteMetrics = {
      workInstrumentation: 'native-array+native-string+real-DOM+decoder-input',
      samples: [] as ContentWork[]
    };
    await run(
      'content-hermes-nodeseek-deep-vote-markers',
      async () => {
        check('HermesInternal' in globalThis, 'Deep vote normalization proof requires Hermes');
        const body =
          'before nsapp://vote?id=7 <a href="/jump/vote">nsapp://vote?id=8</a> nsapp://vote?id=7 ' +
          '<a href="/jump/vote">nsapp://vote?id=9</a> <a href="https://example.com">ordinary link</a> ' +
          '<img src="https://example.com/proof.png"><code>nsapp://vote?id=7 code</code> after';
        for (const depth of [2048, 16_384]) {
          for (const layout of ['div-far', 'div-absent', 'p-far', 'p-absent', 'nested-div']) {
            const tag = layout === 'nested-div' ? 'div' : 'span';
            const outer = layout === 'div-far' ? 'div' : layout === 'p-far' ? 'p' : 'section';
            const inner = layout === 'div-absent' ? 'p' : layout === 'p-absent' ? 'div' : '';
            const root = parseForumContentHtml(
              `<${outer}>${`<${tag}>`.repeat(depth)}${inner ? `<${inner}>` : ''}${body}` +
                `${inner ? `</${inner}>` : ''}${`</${tag}>`.repeat(depth)}</${outer}>` +
                '<forum-nodeseek-poll id="10">unloaded-placeholder</forum-nodeseek-poll>' +
                '<pre><code>nsapp://vote?id=8 protected</code></pre>'
            );
            const sample = createContentWorkSample(layout, depth, root.toString(), root);
            voteMetrics.samples.push(sample);
            const discovered = measureContentWork(
              sample,
              () => {
                const ids = normalizeNodeSeekVoteMarkers(root, ['7', '8']);
                normalizeRenderedNodeSeekPollRoot(root, ['7', '8']);
                return ids;
              },
              root
            );
            check(JSON.stringify(discovered) === JSON.stringify(['7', '8', '9']), 'Vote discovery order changed');
            check(
              JSON.stringify(root.querySelectorAll('forum-nodeseek-poll').map((node) => node.getAttribute('id'))) ===
                JSON.stringify(['7', '8', '10']),
              'Loaded votes were lost, repeated or reordered; an unloaded placeholder changed'
            );
            check(root.querySelectorAll(tag).length === depth + Number(inner === tag), 'Deep wrappers changed');
            check(
              /before[\s\S]*nsapp:\/\/vote\?id=9[\s\S]*ordinary link[\s\S]*after/.test(root.textContent),
              'Ordinary text or unloaded vote marker changed'
            );
            check(root.querySelector('img')?.getAttribute('src') === 'https://example.com/proof.png', 'Media changed');
            check(
              JSON.stringify(root.querySelectorAll('code').map((node) => node.textContent)) ===
                JSON.stringify(['nsapp://vote?id=7 code', 'nsapp://vote?id=8 protected']),
              'Code vote markers were normalized'
            );
            sample.outputVerified = true;
          }
        }
      },
      voteMetrics
    );
    const metadataMetrics = {
      workInstrumentation: 'native-array+native-string+real-DOM+decoder-input',
      samples: [] as ContentWork[]
    };
    await run(
      'content-hermes-deep-image-metadata',
      async () => {
        check('HermesInternal' in globalThis, 'Deep metadata proof requires Hermes');
        for (const depth of [2048, 16_384]) {
          for (const layout of [
            'plain-text',
            'nested-class-meta',
            'image-protected',
            'split-text',
            'unique-text-meta'
          ]) {
            const leaf =
              layout === 'nested-class-meta'
                ? '600×400 1.5 MB'
                : layout === 'image-protected'
                  ? '图片 600×400 1.5 MB<img src="/nested.png">'
                  : layout === 'split-text'
                    ? '图<span>片</span> 6<span>00</span>×4<span>00</span> 1.5<span> M</span>B'
                    : 'ordinary body';
            const opening =
              layout === 'plain-text' || layout === 'split-text'
                ? '<div>'
                : layout === 'unique-text-meta'
                  ? '<div class="meta">x'
                  : '<div class="meta">';
            const html =
              '<section><p>before <a href="/ordinary">ordinary link</a></p>' +
              opening.repeat(depth) +
              leaf +
              '</div>'.repeat(depth) +
              '<img src="/proof.png"><pre><code>&lt;safe&gt;\ncode</code></pre><p>after</p></section>';
            const sample = createContentWorkSample(layout, depth, html);
            metadataMetrics.samples.push(sample);
            const sanitized = measureContentWork(sample, () =>
              sanitizeContentHtmlWithRoot(html, 'https://www.nodeseek.com/post-1-1')
            );
            const removed = layout === 'nested-class-meta' || layout === 'split-text';
            check(sanitized.root.querySelectorAll('div').length === (removed ? 0 : depth), 'Metadata wrappers changed');
            check(
              /before[\s\S]*ordinary link[\s\S]*&lt;safe&gt;[\s\S]*code[\s\S]*after/.test(sanitized.contentHtml),
              'Metadata scan reordered ordinary content'
            );
            check(sanitized.root.querySelector('code')?.textContent === '<safe>\ncode', 'Metadata scan changed code');
            check(
              sanitized.root.querySelectorAll('img').length === (layout === 'image-protected' ? 2 : 1) &&
                sanitized.contentHtml.includes('https://www.nodeseek.com/proof.png'),
              'Metadata scan changed media'
            );
            check(
              sanitized.contentHtml.includes('ordinary body') ===
                (layout === 'plain-text' || layout === 'unique-text-meta'),
              'Metadata scan changed body text'
            );
            if (layout === 'image-protected')
              check(
                sanitized.root.textContent.includes('图片 600×400 1.5 MB'),
                'Image metadata was removed around media'
              );
            if (layout === 'unique-text-meta')
              check(sanitized.root.textContent.split('x').length - 1 === depth, 'Metadata scan lost per-layer text');
            sample.outputVerified = true;
          }
        }
      },
      metadataMetrics
    );
    const renderedPollMetrics = {
      workInstrumentation: 'native-array+native-string+real-DOM+decoder-input',
      samples: [] as ContentWork[]
    };
    await run(
      'content-hermes-nodeseek-deep-rendered-polls',
      async () => {
        check('HermesInternal' in globalThis, 'Deep rendered poll proof requires Hermes');
        const form = (id: string, panel = false) =>
          `<form data-vote-id="${id}"${panel ? ' class="vote-panel"' : ''}><legend>Poll ${id}</legend>` +
          '<label><input type="radio" name="id" value="1" checked>First</label>' +
          '<label><input type="radio" name="id" value="2">Second</label></form>';
        for (const depth of [2048, 16_384]) {
          for (const layout of [
            'form-panel-far',
            'form-panel-absent',
            'form-panel-self',
            'shell-empty',
            'shell-text',
            'shell-media'
          ]) {
            const isForm = layout.startsWith('form-');
            const deep = isForm
              ? `${layout === 'form-panel-far' ? '<div class="vote-panel">' : ''}${'<span>'.repeat(depth)}` +
                form('7', layout === 'form-panel-self') +
                '</span>'.repeat(depth) +
                (layout === 'form-panel-far' ? '</div>' : '') +
                form('8')
              : Array.from(
                  { length: depth },
                  (_, index) => `<div class="${index % 2 ? 'vote-panel' : 'embed-vote'}">`
                ).join('') +
                (layout === 'shell-text'
                  ? 'ordinary body'
                  : layout === 'shell-media'
                    ? '<img src="/nested.png">'
                    : ' ') +
                '<div class="form-mask">hidden mask</div>' +
                '</div>'.repeat(depth);
            const body =
              '<p>before ordinary link</p>' +
              deep +
              '<img src="/proof.png"><pre><code>&lt;safe&gt;\ncode</code></pre>' +
              '<forum-nodeseek-poll id="99">unloaded-placeholder</forum-nodeseek-poll>' +
              '<p>after nsapp://vote?id=99</p>';
            const html = isForm
              ? '<html><body><article><h1 class="post-title">Synthetic deep poll</h1>' +
                `<div class="content-item"><div class="post-content">${body}</div></div></article></body></html>`
              : `<section>${body}</section>`;
            const root = parseForumContentHtml(html);
            const sample = createContentWorkSample(layout, depth, html, root);
            renderedPollMetrics.samples.push(sample);
            let contentRoot = root;
            const detail = measureContentWork(
              sample,
              () => {
                if (isForm) return parseRenderedNodeSeekTopicHtml({ html, root, embedded: null }, '1');
                normalizeRenderedNodeSeekPollRoot(root, []);
              },
              root
            );
            if (isForm) {
              check(detail, 'Rendered poll document was lost');
              check(
                JSON.stringify(detail.polls?.map((poll) => poll.id)) === '["7","8"]',
                'Rendered poll order changed'
              );
              check(
                detail.polls?.every(
                  (poll) =>
                    poll.voted &&
                    poll.options.length === 2 &&
                    poll.options[0].label === 'First' &&
                    poll.options[0].selected &&
                    poll.options[1].label === 'Second' &&
                    !poll.options[1].selected
                ),
                'Rendered poll state changed'
              );
              contentRoot = parseForumContentHtml(detail.contentHtml);
              check(contentRoot.querySelectorAll('form').length === 0, 'Rendered form was not replaced');
              check(
                contentRoot.querySelectorAll('span').length === (layout === 'form-panel-far' ? 0 : depth),
                'Rendered poll selected the wrong ancestor'
              );
              check(
                JSON.stringify(
                  contentRoot.querySelectorAll('forum-nodeseek-poll').map((node) => node.getAttribute('id'))
                ) === '["7","8","99"]',
                'Rendered poll placeholders changed'
              );
            } else {
              check(
                root.querySelectorAll('div').length === (layout === 'shell-empty' ? 0 : depth),
                'Poll shells changed'
              );
              check(!root.textContent.includes('hidden mask'), 'Poll mask survived');
              check(
                root.textContent.includes('ordinary body') === (layout === 'shell-text'),
                'Poll shell text changed'
              );
            }
            check(
              /before[\s\S]*ordinary link[\s\S]*<safe>[\s\S]*code[\s\S]*unloaded-placeholder[\s\S]*after nsapp:\/\/vote\?id=99/.test(
                contentRoot.textContent
              ),
              'Rendered poll scan reordered ordinary or unloaded content'
            );
            check(contentRoot.querySelector('code')?.textContent === '<safe>\ncode', 'Rendered poll scan changed code');
            check(
              contentRoot.querySelectorAll('img').length === (layout === 'shell-media' ? 2 : 1),
              'Rendered poll scan changed media'
            );
            sample.outputVerified = true;
          }
        }
      },
      renderedPollMetrics
    );
    const entityMetrics = {
      workInstrumentation: 'native-array+native-string+real-DOM+decoder-input',
      samples: [] as ContentWork[]
    };
    await run(
      'content-hermes-deep-entity-boundaries',
      async () => {
        check('HermesInternal' in globalThis, 'Entity boundary proof requires Hermes');
        for (const depth of [2048, 16_384]) {
          for (const layout of [
            'single-decimal-leading-cut',
            'single-hex-leading-cut',
            'double-decimal-leading-cut',
            'double-hex-leading-cut',
            'single-decimal-trailing-cut',
            'double-decimal-trailing-cut'
          ]) {
            for (const operation of [
              'createForumTextIndex',
              'sanitizeContentHtmlWithRoot',
              'normalizeRenderedNodeSeekPollRoot'
            ] as const) {
              const double = layout.startsWith('double-');
              const hex = layout.includes('-hex-');
              const trailing = layout.endsWith('trailing-cut');
              const prefix = `${double ? '&amp;' : '&'}#${hex ? 'x' : ''}`;
              const suffix = hex ? '20;' : '32;';
              const className = operation === 'normalizeRenderedNodeSeekPollRoot' ? 'vote-panel' : 'meta';
              const opening = `<div class="${className}">`;
              const chain = trailing
                ? opening.repeat(depth) + prefix + '0</div>'.repeat(depth) + suffix
                : prefix + `${opening}0`.repeat(depth) + suffix + '</div>'.repeat(depth);
              const html =
                `<section>${chain}</section>` +
                (operation === 'createForumTextIndex'
                  ? ''
                  : '<p>after ordinary text</p><pre><code>&lt;safe&gt;\ncode</code></pre>' +
                    '<forum-nodeseek-poll id="99">unloaded-placeholder</forum-nodeseek-poll>');
              const root = parseForumContentHtml(html);
              const nodes = root.querySelectorAll('div');
              const section = root.querySelector('section');
              check(section, 'Entity fixture section is missing');
              const sample = createContentWorkSample(`${layout}:${operation}`, depth, html, root);
              entityMetrics.samples.push(sample);
              const before = root.toString();
              let index: ReturnType<typeof createForumTextIndex> | undefined;
              const resultRoot = measureContentWork(
                sample,
                () => {
                  if (operation === 'sanitizeContentHtmlWithRoot')
                    return sanitizeContentHtmlWithRoot(html, 'https://www.nodeseek.com/post-1-1').root;
                  if (operation === 'normalizeRenderedNodeSeekPollRoot') normalizeRenderedNodeSeekPollRoot(root, []);
                  else {
                    index = createForumTextIndex(root);
                    const expected = trailing
                      ? (double ? '&#0' : '\uFFFD') + '0'.repeat(depth - 1) + suffix
                      : '&#' + (hex ? 'x' : '') + '0'.repeat(depth) + suffix;
                    check(materializeTextRange(index.range(root)) === expected, 'Cross-element entity was decoded');
                    check(index.hasText(section), 'Literal entity text was lost');
                    for (const node of nodes) {
                      check(index.hasText(node), 'Partial entity text was lost');
                      check(index.range(node).length <= 1, 'Entity cut produced too many segments');
                    }
                  }
                  return root;
                },
                root
              );
              if (index) {
                const observedIndex = index;
                for (const position of [0, Math.floor(depth / 2), depth - 1]) {
                  const range = observedIndex.range(nodes[position]);
                  const value = materializeTextRange(range);
                  const expected = trailing
                    ? double
                      ? `&#${'0'.repeat(depth - position)}`
                      : `\uFFFD${'0'.repeat(depth - position - 1)}`
                    : `${'0'.repeat(depth - position)}${suffix}`;
                  check(value === expected, 'Partial entity output changed');
                }
              } else {
                check(resultRoot.toString() === before, 'Public cleanup changed entity or ordinary content');
                check(resultRoot.querySelectorAll('div').length === depth, 'Public cleanup lost entity cuts');
                check(resultRoot.querySelector('code')?.textContent === '<safe>\ncode', 'Entity cleanup changed code');
                check(
                  resultRoot.querySelector('forum-nodeseek-poll')?.getAttribute('id') === '99',
                  'Entity cleanup changed unloaded poll marker'
                );
              }
              sample.outputVerified = true;
            }
          }
        }
      },
      entityMetrics
    );
    const forestMetrics = {
      workInstrumentation: 'native-array+native-string+real-DOM+decoder-input',
      samples: [] as ContentWork[],
      auxOutputs: [] as { name: string; outputVerified: boolean }[]
    };
    await run(
      'content-hermes-text-index-new-subtrees',
      async () => {
        check('HermesInternal' in globalThis, 'New subtree proof requires Hermes');
        for (const depth of [2048, 16_384]) {
          for (const layout of [
            'single-decimal-leading-cut',
            'single-hex-leading-cut',
            'double-decimal-leading-cut',
            'double-hex-leading-cut',
            'single-decimal-trailing-cut',
            'double-decimal-trailing-cut'
          ]) {
            for (const queryOrder of ['root-first', 'leaves-first', 'moved-known'] as const) {
              const double = layout.startsWith('double-');
              const hex = layout.includes('-hex-');
              const trailing = layout.endsWith('trailing-cut');
              const prefix = `${double ? '&amp;' : '&'}#${hex ? 'x' : ''}`;
              const suffix = hex ? '20;' : '32;';
              const chain = trailing
                ? '<span>'.repeat(depth) + prefix + '0</span>'.repeat(depth) + suffix
                : prefix + '<span>0'.repeat(depth) + suffix + '</span>'.repeat(depth);
              const root = parseForumContentHtml(
                '<p>ordinary body</p><pre><code>&lt;safe&gt;</code></pre><img src="/body.png">' +
                  '<aside>&amp;#32;</aside>'
              );
              const index = createForumTextIndex(root);
              const heldRoot = index.range(root);
              const rootBefore = materializeTextRange(heldRoot);
              const known = root.querySelector('aside');
              check(known, 'Known subtree is missing');
              const heldKnown = index.range(known);
              check(materializeTextRange(heldKnown) === '&#32;', 'Known entity snapshot changed');
              const addition = parseForumContentHtml(`<section>${chain}</section>`).firstChild;
              check(addition instanceof HTMLElement, 'New entity subtree is missing');
              root.appendChild(addition);
              if (queryOrder === 'moved-known') {
                known.set_content('moved text');
                addition.appendChild(known);
              }
              const nodes = addition.querySelectorAll('span');
              const sample = createContentWorkSample(layout + ':' + queryOrder, depth, root.toString(), root);
              forestMetrics.samples.push(sample);
              const queryNodes = [addition, ...nodes];
              if (queryOrder !== 'root-first') queryNodes.reverse();
              measureContentWork(
                sample,
                () => {
                  for (let pass = 0; pass < 2; pass++)
                    for (const node of queryNodes) {
                      check(index.hasText(node), 'New subtree visibility changed');
                      check(index.range(node).length <= 1, 'New subtree has too many entity segments');
                    }
                },
                root
              );
              for (const position of [0, Math.floor(depth / 2), depth - 1]) {
                const expected = trailing
                  ? double
                    ? `&#${'0'.repeat(depth - position)}`
                    : `\uFFFD${'0'.repeat(depth - position - 1)}`
                  : `${'0'.repeat(depth - position)}${suffix}`;
                check(materializeTextRange(index.range(nodes[position])) === expected, 'New entity cut output changed');
              }
              check(materializeTextRange(index.range(root)) === rootBefore, 'Known ancestor snapshot was rebuilt');
              check(materializeTextRange(heldRoot) === rootBefore, 'Held root range changed after registration');
              check(materializeTextRange(heldKnown) === '&#32;', 'Held known range changed after moving');
              check(
                materializeTextRange(index.range(known)) === (queryOrder === 'moved-known' ? 'moved text' : '&#32;'),
                'Moved known node was not registered in the new subtree'
              );
              check(root.querySelector('p')?.textContent === 'ordinary body', 'New subtree changed ordinary content');
              check(root.querySelector('code')?.textContent === '<safe>', 'New subtree changed code');
              check(root.querySelector('img')?.getAttribute('src') === '/body.png', 'New subtree changed media');
              sample.outputVerified = true;
            }
          }
        }
        const aux = (name: string, task: () => void) => {
          task();
          forestMetrics.auxOutputs.push({ name, outputVerified: true });
        };
        const crossLeaf = () => {
          const node = parseForumContentHtml('<section>&nb<span>sp;</span></section>').firstChild;
          check(node instanceof HTMLElement, 'Cross-leaf subtree is missing');
          return node;
        };
        aux('multiple-new-trees', () => {
          const root = parseForumContentHtml('<p>stable body</p>');
          const index = createForumTextIndex(root);
          const first = crossLeaf();
          const second = crossLeaf();
          root.appendChild(first);
          root.appendChild(second);
          for (const node of [second, first]) {
            const leaf = node.querySelector('span');
            check(leaf, 'Multiple subtree leaf is missing');
            check(index.hasText(leaf) && index.hasText(node), 'Multiple subtree visibility changed');
            check(materializeTextRange(index.range(node)) === '&nbsp;', 'Multiple subtree decoding changed');
          }
          check(materializeTextRange(index.range(root)) === 'stable body', 'Multiple trees rebuilt known root');
        });
        aux('detached-tree', () => {
          const index = createForumTextIndex(parseForumContentHtml('<p>stable body</p>'));
          const node = crossLeaf();
          const leaf = node.querySelector('span');
          check(leaf, 'Detached subtree leaf is missing');
          check(index.hasText(leaf) && index.hasText(node), 'Detached subtree visibility changed');
          check(materializeTextRange(index.range(node)) === '&nbsp;', 'Detached subtree decoding changed');
        });
        aux('replace-root-child', () => {
          const root = parseForumContentHtml('<section>&amp;#32;</section><p>stable body</p>');
          const index = createForumTextIndex(root);
          const old = root.querySelector('section');
          check(old, 'Replaced subtree is missing');
          const held = index.range(old);
          const replacement = crossLeaf();
          old.replaceWith(replacement);
          check(index.hasText(replacement), 'Replacement subtree visibility changed');
          check(materializeTextRange(index.range(replacement)) === '&nbsp;', 'Replacement decoding changed');
          check(materializeTextRange(held) === '&#32;', 'Replaced subtree held range changed');
        });
        aux('br-hand-descendants', () => {
          const root = parseForumContentHtml('<br><br>');
          const index = createForumTextIndex(root);
          for (const br of root.querySelectorAll('br')) {
            const section = crossLeaf();
            const innerBr = parseForumContentHtml('<br>').firstChild;
            const hand = parseForumContentHtml('<aside>hand text</aside>').firstChild;
            check(innerBr instanceof HTMLElement && hand instanceof HTMLElement, 'Manual br descendants are missing');
            innerBr.appendChild(hand);
            section.appendChild(innerBr);
            br.appendChild(section);
            check(index.hasText(hand), 'Manual br descendant lost visible text');
            check(materializeTextRange(index.range(hand)) === 'hand text', 'Manual br descendant output changed');
            check(index.hasText(section), 'Literal entity text was lost');
            check(materializeTextRange(index.range(section)) === '&nbsp;\n', 'Br ancestor entity output changed');
            check(!index.hasText(br), 'Known br snapshot was rebuilt');
          }
          check(!index.hasText(root), 'Known br root snapshot was rebuilt');
        });
        aux('held-range-tape-immutable', () => {
          const root = parseForumContentHtml('<aside>&amp;#32;</aside>');
          const index = createForumTextIndex(root);
          const known = root.querySelector('aside');
          check(known, 'Held tape known node is missing');
          const held = index.range(known);
          const tape = held[0]?.tape;
          check(tape, 'Held range has no tape');
          const beforeText = tape.text;
          const beforePrefix = Array.from(tape.nonWhitespacePrefix);
          const branch = crossLeaf();
          known.set_content('moved text');
          branch.appendChild(known);
          root.appendChild(branch);
          check(index.hasText(branch), 'Moved branch is not visible');
          check(materializeTextRange(index.range(known)) === 'moved text', 'Moved known range was not refreshed');
          check(materializeTextRange(held) === '&#32;', 'Held range output changed');
          check(
            tape.text === beforeText &&
              beforePrefix.length === tape.nonWhitespacePrefix.length &&
              beforePrefix.every((value, position) => value === tape.nonWhitespacePrefix[position]),
            'Held tape or whitespace prefix changed'
          );
        });
      },
      forestMetrics
    );
    const duplicatePollMetrics = {
      workInstrumentation: 'native-array+native-string+real-DOM+decoder-input',
      samples: [] as ContentWork[],
      auxOutputs: [] as { count: number; outputVerified: boolean }[]
    };
    await run(
      'content-hermes-nodeseek-duplicate-poll-placeholders',
      async () => {
        check('HermesInternal' in globalThis, 'Duplicate poll proof requires Hermes');
        const placeholder = '<forum-nodeseek-poll id="7"></forum-nodeseek-poll>';
        for (const depth of [2048, 16_384]) {
          for (const layout of [
            'duplicate-p-placeholders',
            'nested-div-placeholders',
            'root-sibling-placeholders',
            'wide-anchor-markers',
            'wide-text-markers'
          ]) {
            const html =
              layout === 'duplicate-p-placeholders'
                ? `<p>${placeholder.repeat(depth)}</p>`
                : layout === 'nested-div-placeholders'
                  ? `<div>${placeholder}`.repeat(depth) + 'ordinary body' + '</div>'.repeat(depth)
                  : layout === 'wide-anchor-markers'
                    ? '<a href="/jump/vote">nsapp://vote?id=7</a>'.repeat(depth)
                    : layout === 'wide-text-markers'
                      ? 'before nsapp://vote?id=7 after<span>separator</span>'.repeat(depth)
                      : placeholder.repeat(depth);
            const root = parseForumContentHtml(html);
            const sample = createContentWorkSample(layout, depth, html, root);
            duplicatePollMetrics.samples.push(sample);
            const discovered = measureContentWork(
              sample,
              () => {
                if (layout.startsWith('wide-'))
                  return normalizeNodeSeekVoteMarkers(root, layout === 'wide-anchor-markers' ? [] : ['7']);
                normalizeNodeSeekPollPlaceholderNodes(root, ['7']);
              },
              root
            );
            const polls = root.querySelectorAll('forum-nodeseek-poll');
            check(
              layout === 'wide-anchor-markers'
                ? polls.length === 0
                : polls.length === 1 && polls[0].getAttribute('id') === '7',
              'Duplicate polls changed the loaded placeholder'
            );
            if (layout.startsWith('wide-'))
              check(discovered?.length === 1 && discovered[0] === '7', 'Wide marker discovery changed');
            check(
              root.textContent ===
                (layout === 'nested-div-placeholders'
                  ? 'ordinary body'
                  : layout === 'wide-anchor-markers'
                    ? 'nsapp://vote?id=7'.repeat(depth)
                    : layout === 'wide-text-markers'
                      ? 'before  afterseparator'.repeat(depth)
                      : ''),
              'Duplicate polls changed ordinary content'
            );
            sample.outputVerified = true;
          }
        }
        for (const count of [1, 2, 2048, 16_384]) {
          const prepared = prepareNodeSeekForumContent(`<p>${'nsapp://vote?id=7 '.repeat(count)}</p>`, {
            role: 'opening',
            polls: [
              {
                id: '7',
                options: [
                  { id: 'a', label: 'A' },
                  { id: 'b', label: 'B' }
                ]
              }
            ]
          });
          check(
            (prepared.contentHtml.match(/<forum-nodeseek-poll\b/g) || []).length === 1 &&
              prepared.contentPlan.rows.filter((row) => row.type === 'poll').length === 1,
            'Prepared repeated markers lost the unique loaded poll'
          );
          duplicatePollMetrics.auxOutputs.push({ count, outputVerified: true });
        }
      },
      duplicatePollMetrics
    );
    await verifyContentChain(run);
    await verifyPendingPollMaterialization(run);
    const restrictedMetrics = {
      workInstrumentation: 'native-array+native-string+real-DOM+decoder-input',
      samples: [] as ContentWork[]
    };
    await run(
      'content-hermes-nodeseek-restricted-fallback',
      async () => {
        check('HermesInternal' in globalThis, 'Restricted fallback proof requires Hermes');
        for (const depth of [2048, 16_384]) {
          for (const layout of [
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
          ]) {
            const text =
              layout === 'restricted-same-range'
                ? '权限不足，需要等级 2 才能查看该主题。'
                : layout.endsWith('prefix-negative')
                  ? '登录经验交流'
                  : '页面暂时无法显示，请稍后重试。';
            const escapedPrefix = layout.endsWith('prefix-negative');
            const prefix =
              layout === 'amp-prefix-negative'
                ? '&amp;'
                : layout === 'markup-prefix-negative'
                  ? '&lt;x&gt;'
                  : layout === 'numeric-prefix-negative'
                    ? '&amp;amp;#65;'
                    : layout === 'quoted-prefix-negative'
                      ? '&lt;q &quot; &gt;'
                      : '&lt;script&gt;';
            const document = parseNodeSeekPageDocument(
              layout === 'actual-script-style-negative'
                ? '<h1>Audit</h1><div id="nsk-body">' +
                    '<div>'.repeat(depth) +
                    '<script>&lt;script&gt;权限不足&lt;/script&gt;</script>' +
                    '<style>&lt;q 权限不足&gt;</style>ordinary' +
                    '</div>'.repeat(depth) +
                    '</div>'
                : layout.startsWith('interleaved-br-')
                  ? '<h1>Audit</h1><div id="nsk-body">' +
                    '<div class="notice">ordinary<br>'.repeat(depth) +
                    '登录经验交流' +
                    '</div>'.repeat(depth) +
                    '</div>'
                  : layout === 'numeric-boundary-prefix-negative'
                    ? '<title>sample topic</title><div id="nsk-body"><div>&#' +
                      '0<div>'.repeat(depth) +
                      '65;&amp;' +
                      text +
                      '</div>'.repeat(depth) +
                      '</div></div>'
                    : escapedPrefix
                      ? '<title>sample topic</title><div id="nsk-body">' +
                        ('<div>' + prefix).repeat(depth) +
                        text +
                        (layout === 'script-prefix-negative' ? '&lt;/script&gt;' : '') +
                        '</div>'.repeat(depth) +
                        '</div>'
                      : '<title>NodeSeek</title><div id="nsk-body"><div id="nsk-body-left">' +
                        (layout === 'unrestricted-distinct-prefix' ? '<div>x' : '<div>').repeat(depth) +
                        text +
                        '</div>'.repeat(depth) +
                        '</div></div>'
            );
            if (layout.startsWith('interleaved-br-')) {
              document.root.querySelectorAll('br').forEach((lineBreak, index) => {
                const value = layout.endsWith('-positive') && index === depth - 1 ? '权限不足' : '登录经验交流';
                const notice = parseForumContentHtml(`<section class="notice">${value}</section>`).firstChild;
                check(notice, 'Separate line-break text branch absent');
                lineBreak.appendChild(notice);
              });
            }
            const sample = createContentWorkSample(layout, depth, document.html, document.root);
            restrictedMetrics.samples.push(sample);
            const topic = measureContentWork(
              sample,
              () => parseRenderedNodeSeekTopicHtml(document, '42'),
              document.root
            );
            if (layout === 'restricted-same-range') {
              check(topic?.title === '受限帖子' && topic.contentHtml === text, 'Restricted notice content changed');
              check(
                topic.accessRequirement?.type === 'level' &&
                  topic.accessRequirement.label === '需等级' &&
                  topic.accessRequirement.detail === text,
                'Restricted notice access requirement changed'
              );
            } else if (layout === 'interleaved-br-positive') {
              check(topic?.title === 'Audit' && topic.contentHtml === '权限不足', 'Separate notice was skipped');
              check(topic.accessRequirement?.type === 'permission', 'Separate notice permission changed');
            } else check(topic === null, 'Ordinary fallback became a restricted topic');
            sample.outputVerified = true;
          }
        }
      },
      restrictedMetrics
    );
    await run('feed-hermes-unique-candidate-quota-and-buffer', async () => {
      check('HermesInternal' in globalThis, 'Aggregate Feed proof requires Hermes');
      const buffered: Topic[] = Array.from({ length: 20 }, (_, index) => ({
        source: 'linuxdo',
        id: String(index + 1),
        title: `Buffered ${index + 1}`,
        author: 'alice',
        url: `https://linux.do/t/topic/${index + 1}`,
        createdAt: new Date(Date.UTC(2026, 9, 1, 0, 1, 60 - index)).toISOString()
      }));
      const topics = Array.from({ length: 30 }, (_, index) => ({
        id: index === 0 ? 1 : 100 + index,
        title: `Incoming ${index}`,
        slug: 'topic',
        created_at: new Date(Date.UTC(2026, 9, 1, 0, 0, 30 - index)).toISOString(),
        posts_count: 1,
        ...(index === 0 ? { required_trust_level: 3 } : {})
      }));
      let requests = 0;
      const fetcher = async () => {
        requests += 1;
        return new Response(JSON.stringify({ topic_list: { topics }, categories: [], users: [] }), {
          headers: { 'content-type': 'application/json' }
        });
      };
      const cursor = encodeURIComponent(JSON.stringify({ buffers: { linuxdo: buffered }, nextPages: { linuxdo: 2 } }));
      const first = await getFeed({ source: 'all', page: 2, cursor, limit: 30, includedSources: ['linuxdo'], fetcher });
      check(first.items.length === 30 && mergeTopics([], first.items).length === 30, 'Duplicate consumed page quota');
      check(
        JSON.stringify(first.items.map((item) => item.id)) ===
          JSON.stringify([
            ...buffered.map((item) => item.id),
            ...Array.from({ length: 10 }, (_, index) => String(101 + index))
          ]),
        'Aggregate candidate order changed'
      );
      check(accessRequirementLevelValue(first.items[0].accessRequirement) === 3, 'Duplicate access metadata was lost');
      const second = await getFeed({
        source: 'all',
        page: 3,
        cursor: first.nextCursor ?? undefined,
        limit: 30,
        includedSources: ['linuxdo'],
        fetcher
      });
      check(
        JSON.stringify(second.items.map((item) => item.id)) ===
          JSON.stringify(Array.from({ length: 19 }, (_, index) => String(111 + index))) &&
          !second.hasMore &&
          requests === 1,
        'Remaining cursor candidates were lost, repeated, or fetched again'
      );
    });
    for (const source of ['nodeseek', 'linuxdo', 'v2ex', 'yaohuo'] as const) {
      for (const failedLane of ['topics', 'replies'] as const) {
        await run(`user-${source}-${failedLane}-failure-retry-refresh`, async () => {
          const responses = userResponses(source, false);
          let failure: string | undefined = failedLane;
          const requests: string[] = [];
          const fetcher = async (url: string) => {
            requests.push(url);
            if (laneFor(url) === failure) return new Response('Injected HTTP failure', { status: 503 });
            if (url.includes('/feed/member/')) return new Response('<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
            return new Response(responses[laneFor(url)]);
          };
          const gateway = userGateway(source, fetcher);
          const get = await hook(function useValue() {
            return useUserController(userOptions(source, gateway));
          });
          const other = failedLane === 'topics' ? 'replies' : 'topics';
          const error = () => (failedLane === 'topics' ? get().userTopicsError : get().userRepliesError);
          await until(
            () => get().userProfile?.[other]?.length === 1 && error(),
            'Failed lane or healthy lane not settled'
          );
          check(get().userProfile?.[failedLane] === undefined, 'Failure seeded fake empty success');
          const before = requests.length;
          failure = undefined;
          await (failedLane === 'topics' ? get().retryUserTopics() : get().retryUserReplies());
          await until(
            () => get().userProfile?.[failedLane]?.length === 1 && !error(),
            'Independent retry did not recover'
          );
          check(!requests.slice(before).some((url) => laneFor(url) === other), 'Retry reread healthy lane');
          const trusted = JSON.stringify(get().userProfile?.[failedLane]);
          failure = failedLane;
          await get().refreshUser();
          await until(error, 'Failed refresh not exposed');
          check(JSON.stringify(get().userProfile?.[failedLane]) === trusted, 'Failed refresh replaced trusted data');
        });
      }
    }
    for (const order of ['page-first', 'refresh-first']) {
      await run(`user-race-${order}`, async () => {
        const page = deferred();
        const refresh = deferred();
        let pageStarted = false;
        let refreshStarted = false;
        let refreshing = false;
        const fetcher = async (url: string) => {
          if (url.includes('getInfo')) {
            if (refreshing) {
              refreshStarted = true;
              await refresh.promise;
            }
            return new Response(
              JSON.stringify({ success: true, detail: { member_id: 7, member_name: 'alice', nPost: 30, nComment: 0 } })
            );
          }
          if (url.includes('list-comments')) return new Response('{"success":true,"comments":[]}');
          if (new URL(url).searchParams.get('page') === '2') {
            pageStarted = true;
            await page.promise;
            return new Response(JSON.stringify({ success: true, discussions: [{ post_id: 999, title: 'late page' }] }));
          }
          // Boundary fixtures use only already-evidenced NodeSeek fields.
          return new Response(
            JSON.stringify({
              success: true,
              discussions: Array.from({ length: 15 }, (_, index) => ({
                post_id: (refreshing ? 100 : 1) + index,
                title: refreshing ? 'fresh' : 'old'
              }))
            })
          );
        };
        const gateway = userGateway('nodeseek', fetcher);
        const get = await hook(function useValue() {
          return useUserController(userOptions('nodeseek', gateway));
        });
        await until(() => get().userProfile?.topics?.length === 15, 'Initial page not loaded');
        const paging = get().loadMoreUserTopics();
        await until(() => pageStarted, 'Next page not started');
        refreshing = true;
        const refreshingPromise = get().refreshUser();
        await until(() => refreshStarted, 'Refresh did not start');
        if (order === 'page-first') {
          page.release();
          await paging;
          refresh.release();
          await refreshingPromise;
        } else {
          refresh.release();
          await refreshingPromise;
          page.release();
          await paging;
        }
        await until(() => get().userProfile?.topics?.[0]?.id === '100', 'Fresh first page was overwritten');
        check(
          get().userProfile?.topics?.length === 15 && !get().userProfile?.topics?.some((topic) => topic.id === '999'),
          'Canceled old page leaked into refreshed list'
        );
      });
    }
    for (const outcome of ['success', 'failure']) {
      await run(`feed-native-host-cold-${outcome}`, async () => {
        const pending = deferred();
        let pendingStarted = false;
        const response = (title: string) =>
          new Response(
            JSON.stringify({
              topic_list: {
                topics: [{ id: 1, title, slug: 'sample', created_at: '2026-05-20T00:00:00Z', posts_count: 1 }]
              }
            })
          );
        const gateway = userGateway('linuxdo', async (url) => {
          if (url.includes('/new.json')) {
            pendingStarted = true;
            await pending.promise;
            return outcome === 'success'
              ? response('FRESH_PROOF_TOPIC')
              : new Response('Injected failure', { status: 503 });
          }
          return response('INITIAL_PROOF_TOPIC');
        });
        const scrollRef: { current: FlashListRef<Topic> | null } = { current: null };
        let current: ReturnType<typeof useFeedController> | undefined;
        const get = () => {
          check(current, 'Feed not mounted');
          return current;
        };
        mount(
          <FeedProbe
            gateway={gateway}
            scrollRef={scrollRef}
            observe={(value) => {
              current = value;
            }}
          />
        );
        await until(() => current?.shownFeedItems.length && scrollRef.current, 'Initial native Feed not mounted');
        get().changeFeedSource('linuxdo');
        await until(
          () => current?.feedSource === 'linuxdo' && !current.feedBusy && scrollRef.current,
          'Source Feed not ready'
        );
        await delay(200);
        const before = findNodeHandle(scrollRef.current?.getNativeScrollRef() ?? null);
        check(before, 'No native FlashList host');
        get().setFeedFilter('new-topics');
        await until(() => pendingStarted && current?.feedBusy, 'Cold filter did not wait for HTTP');
        await delay(200);
        check(get().shownFeedItems.length === 0, 'Cold pending filter displayed stale rows');
        const pendingHost = findNodeHandle(scrollRef.current?.getNativeScrollRef() ?? null);
        check(pendingHost === before, `Cold pending filter replaced native list host: ${before} -> ${pendingHost}`);
        pending.release();
        await until(() => !get().feedBusy, 'Filter did not settle');
        await delay(200);
        check(
          findNodeHandle(scrollRef.current?.getNativeScrollRef() ?? null) === before,
          'Filter result replaced native list host'
        );
        check(
          outcome === 'success'
            ? get().shownFeedItems[0]?.title === 'FRESH_PROOF_TOPIC'
            : get().shownFeedItems.length === 0,
          'Filter displayed stale rows'
        );
      });
    }
    for (const mode of ['cancel-reopen', 'inactive', 'scope-change', 'unmount']) {
      await run(`verification-core-${mode}`, async () => {
        const handoff = deferred();
        let handoffStarted = false;
        let resumed = 0;
        const control = {
          active: true,
          scope: 'linuxdo:7:0',
          handoff: async () => {
            handoffStarted = true;
            if (mode !== 'cancel-reopen') await handoff.promise;
          }
        };
        const get = await hook(function useValue() {
          return useRecoveryProbe(control);
        });
        const recovery = (): LinuxDoReadRecovery => ({
          queryKey: ['device-proof', mode],
          isCurrent: () => control.active,
          resume: async () => {
            resumed += 1;
            return 'completed';
          }
        });
        check(await get().showLinuxDoVerification('controlled proof', recovery()), 'Verification did not open');
        if (mode === 'cancel-reopen') {
          get().closeLinuxDoPanel();
          check(
            await get().showLinuxDoVerification('controlled reopen', recovery()),
            'Canceled verification could not reopen'
          );
          await get().checkLinuxDoCookie();
          await get().checkLinuxDoCookie();
          check(resumed === 1, 'Current recovery was not resumed exactly once');
        } else {
          const checking = get().checkLinuxDoCookie();
          await until(() => handoffStarted, 'Cookie handoff not reached');
          if (mode === 'inactive') control.active = false;
          if (mode === 'scope-change') control.scope = 'linuxdo:8:1';
          if (mode === 'unmount') {
            mount(null);
            await delay(100);
          }
          handoff.release();
          await checking;
          check(resumed === 0, 'Invalid recovery resumed its old request');
        }
        get().closeLinuxDoPanel();
        handoff.release();
      });
    }
    for (const invalidation of ['identity', 'epoch', 'source', 'surface'] as const) {
      await run(`write-csrf-${invalidation}`, async () => {
        const csrf = deferred();
        let entered = false;
        let writes = 0;
        const snapshot: SessionRuntimeSnapshot = {
          source: 'linuxdo',
          authenticated: true,
          authSurfaceOpen: false,
          identityKey: 'linuxdo:7',
          identityTrust: 'confirmed',
          sessionEpoch: 0,
          sourceEnabled: true
        };
        const ticket = { source: 'linuxdo' as const, identityKey: 'linuxdo:7', sessionEpoch: 0 };
        const fetcher = withRequestBeforeSend(
          async (url) => {
            if (url.endsWith('/session/csrf')) {
              entered = true;
              await csrf.promise;
              return new Response('{"csrf":"isolated-fixture"}');
            }
            writes += 1;
            return new Response('{}');
          },
          () => check(validateWritableSessionTicket(ticket, snapshot), 'stale write ticket')
        );
        const pending = runLinuxDoAction({
          request: buildDiscourseActionRequest({ type: 'set-like', postId: '1', active: true }),
          fetcher
        }).then(
          () => false,
          () => true
        );
        await until(() => entered, 'CSRF did not start');
        if (invalidation === 'identity') snapshot.identityKey = 'linuxdo:8';
        if (invalidation === 'epoch') snapshot.sessionEpoch += 1;
        if (invalidation === 'source') snapshot.sourceEnabled = false;
        if (invalidation === 'surface') snapshot.authSurfaceOpen = true;
        csrf.release();
        check((await pending) && writes === 0, 'Stale action sent a side-effect request');
      });
    }
    await run('write-native-proxy-preparation', async () => {
      const module = NativeModules.NetworkProxyModule;
      check(typeof module?.applyProxy === 'function', 'Missing real Native proxy module');
      const original = module.applyProxy;
      const prepared = deferred();
      let entered = false;
      let writes = 0;
      let current = true;
      try {
        module.applyProxy = async (...args: unknown[]) => {
          entered = true;
          await prepared.promise;
          return original(...args);
        };
        const get = await hook(function useValue() {
          return useNetworkProxyRuntime({
            notify: () => undefined,
            baseFetcher: async () => {
              writes += 1;
              return new Response('{}');
            }
          });
        });
        await until(() => entered, 'Native proxy preparation not reached');
        const guarded = withRequestBeforeSend(get().networkProxyFetcher, () => check(current, 'stale write ticket'));
        const pending = guarded('https://linux.do/post_actions', { method: 'POST' }).then(
          () => false,
          () => true
        );
        current = false;
        prepared.release();
        check((await pending) && writes === 0, 'Proxy preparation sent a stale write');
      } finally {
        prepared.release();
        module.applyProxy = original;
      }
    });
    await run('write-confirmed-response-after-invalidation', async () => {
      let current = true;
      let requests = 0;
      const fetcher = withRequestBeforeSend(
        async (url) => {
          requests += 1;
          if (url.endsWith('/session/csrf')) return new Response('{"csrf":"isolated-fixture"}');
          current = false;
          return new Response('{}');
        },
        () => check(current, 'stale write ticket')
      );
      await runLinuxDoAction({
        request: buildDiscourseActionRequest({ type: 'set-like', postId: '1', active: true }),
        fetcher
      });
      check(requests === 2 && !current, 'Confirmed response was retried or post-validated');
    });
    const sessions = {
      nodeseek: createAccountSessionViewModel(
        accountSessionSnapshotFromObservation(createAccountSessionSnapshot('nodeseek'), {
          session: {
            site: 'nodeseek',
            status: 'logged-in',
            cookieSummary: [],
            isVerifying: false,
            currentUser: { source: 'nodeseek', id: '7', username: 'alice', url: 'https://www.nodeseek.com/space/7' }
          }
        })
      ),
      linuxdo: createAccountSessionViewModel(createAccountSessionSnapshot('linuxdo')),
      yaohuo: createAccountSessionViewModel(createAccountSessionSnapshot('yaohuo'))
    };
    const notificationOptions = {
      appActive: false,
      contentSourcesReady: true,
      enabledNotificationSources: ['nodeseek', 'linuxdo', 'yaohuo'] as const,
      fetcher: async () => {
        throw new Error('Unexpected notification network');
      },
      getLinuxDoUserAgent: () => '',
      getNodeSeekUserAgent: () => '',
      onSessionExpired: () => undefined,
      requestAccountRecheck: () => undefined,
      openSource: () => false,
      privateAccessAllowed: () => false,
      remoteReady: false,
      sessionEpochs: initialForumSessionEpochs,
      sessions
    };
    const state = defaultNotificationState();
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['kept'],
      unreadCount: 80
    };
    for (const mode of ['storage-retry', 'permission-error', 'permission-denied', 'unmount-late']) {
      await run(`notification-${mode}`, async () => {
        await AsyncStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(state));
        const originalGet = AsyncStorage.getItem;
        const originalPermission = Permissions.getPermissionsAsync;
        const paused = deferred();
        let rejectStorage = mode === 'storage-retry';
        let reads = 0;
        try {
          AsyncStorage.getItem = async (key) => {
            if (key === NOTIFICATION_STORAGE_KEY) {
              reads += 1;
              if (rejectStorage) throw new Error('Injected storage read error');
              if (mode === 'unmount-late') await paused.promise;
            }
            return originalGet.call(AsyncStorage, key);
          };
          if (mode === 'permission-error')
            Permissions.getPermissionsAsync = async () => {
              throw new Error('Injected platform permission error');
            };
          const get = await hook(function useValue() {
            return useNotificationsRuntime(notificationOptions);
          });
          if (mode === 'storage-retry') {
            await until(
              () => get().initializationError && !get().ready && get().permission !== 'checking',
              'Storage error not surfaced'
            );
            let rejected = false;
            try {
              await get().setGlobalEnabled(false);
            } catch {
              rejected = true;
            }
            check(
              rejected && (await originalGet.call(AsyncStorage, NOTIFICATION_STORAGE_KEY)) === JSON.stringify(state),
              'Failed initialization overwrote state'
            );
            rejectStorage = false;
            const a = get().retryInitialization();
            const b = get().retryInitialization();
            check(a === b, 'Concurrent retries were not coalesced');
            await a;
            await until(() => get().ready && !get().initializationError, 'Initialization retry failed');
            check(
              reads === 2 &&
                get().state.sources.nodeseek.unreadCount === 80 &&
                get().state.sources.nodeseek.deliveredIds[0] === 'kept',
              'Stored watermark/settings changed'
            );
          } else if (mode === 'permission-error') {
            await until(
              () => get().ready && get().permission === 'unavailable',
              'Permission error blocked storage or looked denied'
            );
            check(
              Boolean(get().initializationError) &&
                !get().backgroundEnabled &&
                get().state.sources.nodeseek.unreadCount === 80,
              'Unknown permission enabled delivery or lost state'
            );
          } else if (mode === 'permission-denied') {
            await until(() => get().ready && get().permission !== 'checking', 'Native permission probe did not settle');
            check(
              get().permission === 'denied' && !get().initializationError && !get().backgroundEnabled,
              'Native permission denial was confused with a probe error'
            );
          } else {
            await until(() => reads === 1, 'Storage read not started');
            mount(null);
            await delay(100);
            paused.release();
            await delay(150);
            check(
              !get().ready && (await loadNotificationState()).sources.nodeseek.unreadCount === 80,
              'Unmounted initialization committed late result'
            );
          }
        } finally {
          paused.release();
          AsyncStorage.getItem = originalGet;
          Permissions.getPermissionsAsync = originalPermission;
        }
      });
    }
    // The guarded runner grants this permission only on the named isolated AVD, then restores its prior state.
    write('grant-notifications');
    const permissionDeadline = Date.now() + 15000;
    while (!(await notificationPermissionGranted())) {
      check(Date.now() < permissionDeadline, 'Runner did not grant isolated notification permission');
      await delay(100);
    }
    for (const mode of ['total-80', 'total-1', 'native-failure', 'store-failure', 'identity-change']) {
      await run(`notification-worker-${mode}`, async () => {
        const identityKey = 'nodeseek:7';
        const state = defaultNotificationState();
        state.globalEnabled = true;
        state.sources.nodeseek = {
          ...state.sources.nodeseek,
          intentEnabled: true,
          identityKey,
          baselineReady: true,
          deliveredIds: ['old']
        };
        await saveNotificationState(state);
        const total = mode === 'total-1' ? 1 : 80;
        await recordNotificationSnapshot('nodeseek', identityKey, total, '2026-09-16T00:00:00.000Z');
        let activeIdentity = identityKey;
        let pageRequests = 0;
        let nativeFailureSeen = false;
        let storeFailureSeen = false;
        const originalSet = AsyncStorage.setItem;
        try {
          if (mode === 'store-failure')
            AsyncStorage.setItem = async (key, value) => {
              if (
                !storeFailureSeen &&
                key === NOTIFICATION_STORAGE_KEY &&
                JSON.parse(value).sources?.nodeseek?.notificationIdentifier
              ) {
                storeFailureSeen = true;
                throw new Error('Injected delivery storage failure');
              }
              return originalSet.call(AsyncStorage, key, value);
            };
          const result = await runNotificationBackgroundWorker({
            sources: ['nodeseek'],
            sourceAllowed: () => true,
            privateAccessAllowed: (_source, identity) => identity === activeIdentity,
            network: {
              restoreProxy: async () => undefined,
              probeAccess: async () => ({ identityKey, userId: '7' }),
              listPage: async () => {
                pageRequests += 1;
                return {
                  quality: 'complete',
                  items: Array.from({ length: 60 }, (_, index) => ({
                    source: 'nodeseek' as const,
                    id: String(index),
                    kind: 'reply' as const,
                    actor: { name: '设备测试' },
                    title: '合成消息',
                    createdAt: null,
                    unread: mode !== 'total-1',
                    target: { type: 'information' as const }
                  })),
                  cursor: 'next',
                  hasMore: true
                };
              }
            },
            store: {
              load: loadNotificationState,
              record: recordNotificationDelivery,
              clearForContentDisable: clearNotificationSourceForContentDisable
            },
            system: {
              permissionGranted: notificationPermissionGranted,
              reconcileDigests: reconcileSourceNotificationSlots,
              presentDigest: async (source, digest, identifier) => {
                if (mode === 'native-failure') {
                  nativeFailureSeen = true;
                  throw new Error('Injected Native presentation failure');
                }
                const value = await presentSourceNotification(source, digest, identifier);
                if (mode === 'identity-change') {
                  activeIdentity = 'nodeseek:8';
                  await resetNotificationSourceIdentity('nodeseek', activeIdentity);
                }
                return value;
              },
              dismissDigest: (_source, identifier) => dismissSourceNotificationExact(identifier)
            }
          });
          const persisted = (await loadNotificationState()).sources.nodeseek;
          check(pageRequests === 1, 'Scan exceeded the 60-item bound');
          if (mode === 'identity-change')
            check(
              persisted.identityKey === activeIdentity && persisted.deliveredIds.length === 0,
              'Old delivery polluted the new identity'
            );
          else check(persisted.unreadCount === total, 'Scan sample overwrote authoritative total');
          if (mode === 'native-failure' || mode === 'store-failure')
            check(
              result.failedSources === 1 &&
                persisted.deliveredIds.join('|') === 'old' &&
                (nativeFailureSeen || storeFailureSeen),
              'Delivery failure committed its watermark'
            );
          const presented = await Notifications.getPresentedNotificationsAsync();
          const identifiers = notificationIdentifiersForIdentity('nodeseek', identityKey);
          const visible = presented.filter((item) => identifiers.includes(item.request.identifier));
          if (mode === 'total-80')
            check(
              result.delivered === 60 &&
                visible.length === 1 &&
                persisted.notificationIdentifier === visible[0].request.identifier,
              'Successful digest did not reach Android'
            );
          else check(visible.length === 0, 'Failed/stale/no-unread delivery left a visible digest');
        } finally {
          AsyncStorage.setItem = originalSet;
          for (const identifier of notificationIdentifiersForIdentity('nodeseek', identityKey))
            await dismissSourceNotificationExact(identifier);
        }
      });
    }
    for (const quality of ['partial', 'invalid', 'legacy'] as const)
      await run(`notification-quality-${quality}`, () => verifyNotificationQuality(quality));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNotificationState === null) await AsyncStorage.removeItem(NOTIFICATION_STORAGE_KEY);
    else await AsyncStorage.setItem(NOTIFICATION_STORAGE_KEY, originalNotificationState);
    mount(null);
    appQueryClient.clear();
  }
  write(results.every((result) => result.passed) ? 'passed' : 'failed');
}

function userGateway(source: Source, fetcher: (url: string) => Promise<Response>) {
  return createReadGateway({
    fetcher,
    anonymousFetcher: fetcher,
    nodeSeekUserAgent: () => 'isolated-proof',
    getEnabledSources: () => [source],
    readSessionRuntimeSnapshot: (site) => ({
      source: site,
      authenticated: true,
      authSurfaceOpen: false,
      identityKey: `${site}:7`,
      identityTrust: 'confirmed',
      sessionEpoch: 0,
      sourceEnabled: true
    })
  });
}
function userOptions(source: Source, readGateway: ReturnType<typeof createReadGateway>) {
  return {
    active: true,
    notify: () => undefined,
    readerData: createEmptyReaderData(),
    readGateway,
    showLinuxDoVerification: () => undefined,
    showNodeSeekVerification: () => undefined,
    showYaohuoLogin: () => undefined,
    user: { source, id: '7', username: 'alice', url: 'https://example.invalid/isolated-user' }
  };
}
const proofReader = createEmptyReaderData();
const proofStyle = { settings: proofReader.settings, theme: createTheme(proofReader.settings) };
const feedReader = {
  ...proofReader,
  settings: {
    ...proofReader.settings,
    contentSources: proofReader.settings.contentSources.map((item) => ({ ...item, enabled: item.source === 'linuxdo' }))
  }
};
function FeedProbe({
  gateway,
  scrollRef,
  observe
}: {
  gateway: ReturnType<typeof createReadGateway>;
  scrollRef: { current: FlashListRef<Topic> | null };
  observe: (value: ReturnType<typeof useFeedController>) => void;
}) {
  const controller = useFeedController({
    enabledSources: ['linuxdo'],
    enabledSourcesKey: 'linuxdo',
    active: true,
    catalogCategories: [],
    linuxDoVerificationActive: false,
    notify: () => undefined,
    readerData: feedReader,
    readerDataLoaded: true,
    showLinuxDoVerification: () => undefined,
    showNodeSeekVerification: () => undefined,
    showYaohuoLogin: () => undefined,
    readGateway: gateway
  });
  useLayoutEffect(() => observe(controller));
  return (
    <FeedScreen
      busy={controller.feedBusy}
      categories={controller.feedCategories}
      categoryFilter={controller.categoryFilter}
      feedHasMore={controller.activeFeedState.hasMore}
      feedItems={controller.shownFeedItems}
      feedOutcomeKind={controller.feedOutcomeKind}
      feedPage={controller.activeFeedState.page}
      feedFilter={controller.feedFilter}
      feedFilters={controller.feedFilters}
      feedSource={controller.feedSource}
      enabledFeedSources={controller.enabledFeedSources}
      loadMoreFailureSignal={controller.activeFeedState.loadMoreFailureSignal}
      loadingMore={controller.activeFeedState.loadingMore}
      topicStateIndex={{ favorites: {}, history: {}, listDensity: proofReader.settings.listDensity }}
      readingFilter={controller.readingFilter}
      refreshing={controller.activeFeedState.refreshing}
      scrollRef={scrollRef}
      onCategoryChange={controller.setCategoryFilter}
      onFeedFilterChange={controller.setFeedFilter}
      onFeedSourceChange={controller.changeFeedSource}
      onManageContentSources={() => undefined}
      onLoadMore={() => undefined}
      onOpenTopic={() => undefined}
      onReadingFilterChange={controller.setReadingFilter}
      onRefresh={controller.refreshFeed}
    />
  );
}
function useRecoveryProbe(control: { active: boolean; scope: string; handoff: () => Promise<void> }) {
  const visible = useRef(false);
  return useVerificationController({
    awaitLinuxDoCookieHandoff: control.handoff,
    getRecoveryScope: () => control.scope,
    changeNodeSeekLoginPanel: () => undefined,
    checkingRequestIdRef: useRef(0),
    closeYaohuoLoginPanel: () => undefined,
    commitLinuxDoWebViewUserAgent: () => undefined,
    linuxDoPanelClosingSessionRef: useRef<number | null>(null),
    linuxDoPanelCloseSettleTimerRef: useRef<ReturnType<typeof setTimeout> | null>(null),
    linuxDoWebViewMountTimerRef: useRef<ReturnType<typeof setTimeout> | null>(null),
    linuxDoWebViewRef: useRef<WebView | null>(null),
    linuxDoWebViewSessionRef: useRef(0),
    isLinuxDoSurfaceVisible: () => visible.current,
    notify: () => undefined,
    onLoginWebViewFailure: () => undefined,
    onLinuxDoSurfaceClosed: () => {
      visible.current = false;
    },
    onLinuxDoSurfaceOpened: () => {
      visible.current = true;
    },
    prepareLinuxDoCookieResponseBarrier: async () => undefined,
    reconcileAccountStatus: async (): Promise<AccountReconcileResult> => ({
      status: 'same',
      session: {
        site: 'linuxdo',
        status: 'logged-in',
        cookieSummary: [],
        isVerifying: false,
        currentUser: { source: 'linuxdo', id: '7', username: 'alice', url: 'https://linux.do/u/alice' }
      }
    }),
    setChecking: () => undefined,
    setLinuxDoWebViewError: () => undefined,
    setLinuxDoWebViewKey: () => undefined,
    setLoadingLinuxDoPage: () => undefined,
    setMountLinuxDoWebView: () => undefined,
    updateLinuxDoSession: () => undefined,
    updateNodeSeekSession: () => undefined
  });
}
function ProofApp() {
  const [content, setContent] = useState<ReactNode>(null);
  const [status, setStatus] = useState('Isolated remediation proof');
  useEffect(() => {
    void Linking.getInitialURL().then((url) => {
      const background = /^wzreviewproof:\/\/background\/(success|deadline|cleanup)\/([a-f0-9]{32})$/.exec(url || '');
      if (background) {
        void prepareBackgroundProof(background[1] as 'success' | 'deadline' | 'cleanup', background[2]).then(
          () => setStatus(`Background proof ${background[1]} ready`),
          (error: unknown) => setStatus(String(error))
        );
        return;
      }
      const exports = /^wzreviewproof:\/\/exports\/([a-f0-9]{32})$/.exec(url || '');
      if (exports) {
        setContent(<PlatformExportsProof token={exports[1]} />);
        return;
      }
      const acceptance = /^wzreviewproof:\/\/(boundaries|recovery|notification)\/([a-f0-9]{32})$/.exec(url || '');
      if (acceptance) {
        setContent(<AcceptanceProof mode={acceptance[1]} token={acceptance[2]} />);
        setStatus('Pro 修复专项设备验收');
        return;
      }
      const token = /^wzreviewproof:\/\/run\/([a-f0-9]{32})$/.exec(url || '')?.[1];
      if (token) void execute(token, setContent, setStatus).catch((error: unknown) => setStatus(String(error)));
    });
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ReaderStyleProvider value={proofStyle}>
          <QueryClientProvider client={appQueryClient}>
            <View style={{ flex: 1, paddingTop: 60 }}>
              <Text>{status}</Text>
              {content}
            </View>
          </QueryClientProvider>
        </ReaderStyleProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
registerRootComponent(ProofApp);
