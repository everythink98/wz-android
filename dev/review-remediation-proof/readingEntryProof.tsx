import { useLayoutEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { findNodeHandle, type NativeScrollEvent, type NativeSyntheticEvent, View } from 'react-native';
import type { FlashListRef } from '@shopify/flash-list';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { createDiscourseReadingRuntime } from '@/platform/query/discourseReadingRuntime';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { createStardustPayments } from '@/features/topic/actions/stardustPayments';
import type { ReplyOrder, TopicDetail, TopicLocationTarget } from '@/domain/forum/models';
import { prepareRepliesContent, prepareTopicContent } from '@/domain/forum/topicContentSplit';
import type { ReadGateway } from '@/sources/readGateway';
import { TopicContentList } from '@/features/topic/components/TopicContentList';
import type { TopicActionsController } from '@/features/topic/actions/useTopicActionsController';
import type { TopicListItem } from '@/features/topic/model/topicListModel';
import { useTopicController } from '@/features/topic/useTopicController';
import { useTopicSessionController } from '@/features/topic/useTopicSessionController';
import { useHtmlRenderingController } from '@/features/topic/rendering/useHtmlRenderingController';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { inactivePostInteractionActions } from '../../tests/ui/topicInteractionFixture';
import { check } from '../proofCheck';

export const readingEntryProofModes = ['cold', 'cached'] as const;
export type ReadingProofAction = { id: string; from: ReplyOrder; to: ReplyOrder };
type Controller = ReturnType<typeof useTopicController>;
type Session = ReturnType<typeof useTopicSessionController>;
type ScrollCommand = Parameters<FlashListRef<TopicListItem>['scrollToIndex']>[0];
type NativeReceipt = { at: number; timestamp: number; offset: number; height: number; contentHeight: number };
type PositionReceipt = { command: number; at: number };
type HeldScroll = { command: number; params: ScrollCommand; invoke: () => Promise<void>; finish: () => void };
type ProofMetrics = {
  mode: 'cold' | 'cached';
  nativeHost?: number;
  entry?: { ready: boolean; windowReady: boolean; positionReady: boolean; registrations: number };
  windowBeforeNative?: { heldCommands: number; positionReady: boolean };
  positions: PositionReceipt[];
  native: NativeReceipt[];
  commands: { command: number; index: number; at: number; held: boolean }[];
  obsoleteOffset?: { old: number; currentPixel: number; height: number; completed: number };
  finalTarget?: { command: number; index: number; pixel: number; height: number };
  orders: {
    order: ReplyOrder;
    firstFloor?: number;
    nativeHost: number | null;
    offset: number;
    anchorIndex: number;
    pixel: number;
    height: number;
    uiAcknowledged: true;
  }[];
  failureState?: {
    command: number;
    location?: TopicLocationTarget;
    ready?: boolean;
    windowReady?: boolean;
    positionReady?: boolean;
    topicLoaded: boolean;
    topicBusy?: boolean;
    repliesLoading?: boolean;
    replyCount: number;
    replyCalls: number;
    topicCalls: number;
    registrations: number;
    listAttached: boolean;
    targetIndex: number;
    heldCommands: number;
    replyQuery?: { status: string; fetchStatus: string; isInvalidated: boolean };
  };
  localSends: number;
};
type Control = {
  hold: boolean;
  command: number;
  nativeRef: FlashListRef<TopicListItem> | null;
  current?: { read: Controller; session: Session };
  locate?: (location: TopicLocationTarget, id: number) => void;
  held: HeldScroll[];
  metrics: ProofMetrics;
};

function barrier() {
  let release: () => void = () => {
    throw new Error('Uninitialized reading barrier');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
const noop = () => undefined;
const unexpected = async () => {
  throw new Error('Unexpected write or transport in isolated reading proof');
};
const actions: TopicActionsController = {
  ...inactivePostInteractionActions(),
  actionBusy: false,
  replyImageUploading: false,
  decisionFor: () => ({ allowed: false, reason: 'unsupported' }),
  bookmarkOnDiscourseSite: unexpected,
  collectOnNodeSeekSite: unexpected,
  deleteReply: unexpected,
  editReply: unexpected,
  favoriteOnYaohuoSite: unexpected,
  interact: unexpected,
  loadLinuxDoPollCapabilities: unexpected,
  loadLinuxDoTemplates: unexpected,
  resolveLinuxDoUpload: unexpected,
  loadNodeSeekStardustStatus: unexpected,
  lockNodeSeekPoll: unexpected,
  payNodeSeekStardust: unexpected,
  stardustPayments: createStardustPayments(),
  stardustPayer: 'nodeseek:fixture',
  submitReply: unexpected,
  uploadReplyImage: unexpected,
  uploadReplyImageMarkup: unexpected,
  useLinuxDoTemplate: unexpected,
  policySubmissions: {},
  setPolicyAcceptance: unexpected,
  votePoll: unexpected
};

// Only controls the physical command boundary. Every getter still reads the real FlashList.
// onScrollProgress below receives accepted real Native events; it is never manually invoked.
function controlledRef(control: Control): RefObject<FlashListRef<TopicListItem> | null> {
  let proxy: FlashListRef<TopicListItem> | null = null;
  return {
    get current() {
      return proxy;
    },
    set current(value) {
      control.nativeRef = value;
      proxy =
        value &&
        new Proxy(value, {
          get(target, key, receiver) {
            if (key !== 'scrollToIndex') return Reflect.get(target, key, receiver);
            return (params: ScrollCommand) => {
              control.metrics.commands.push({
                command: control.command,
                index: params.index,
                at: performance.now(),
                held: control.hold
              });
              if (!control.hold) return target.scrollToIndex(params);
              return new Promise<void>((finish) => {
                control.held.push({
                  command: control.command,
                  params,
                  invoke: () => target.scrollToIndex(params),
                  finish
                });
              });
            };
          }
        });
    }
  };
}

export function ReadingProbe({
  observe,
  onPositioned,
  onNativeScroll,
  detail,
  gateway,
  list
}: {
  observe: (value: {
    read: Controller;
    session: Session;
    command: number;
    locate: NonNullable<Control['locate']>;
  }) => void;
  onPositioned: (command: number) => void;
  onNativeScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  detail: TopicDetail;
  gateway: ReadGateway;
  list: RefObject<FlashListRef<TopicListItem> | null>;
}) {
  const [command, setCommand] = useState<{ location?: TopicLocationTarget; id: number }>({ id: 1 });
  const reader = useMemo(() => createEmptyReaderData(), []);
  const session = useTopicSessionController({ notify: noop, topic: detail });
  const read = useTopicController({
    focused: true,
    appActive: true,
    commitReaderData: noop,
    notify: noop,
    onNodeSeekTopicVerificationRequired: unexpected,
    onOpenTopic: noop,
    readerData: reader,
    showLinuxDoVerification: unexpected,
    showYaohuoLogin: unexpected,
    readGateway: gateway,
    location: command.location,
    locationRequestId: command.id,
    topic: detail,
    topicSession: session
  });
  const { settings, theme } = useReaderThemeStyles(() => ({}));
  const html = useHtmlRenderingController({
    mediaSessionIdentity: `reading-proof:${detail.id}`,
    selectedTopic: detail,
    topicDetail: read.topicDetail,
    settings,
    theme,
    webViewBlockMessage: '',
    onOpenExternalUrl: noop,
    onOpenImagePreview: noop,
    onOpenTopic: noop,
    onOpenUser: noop
  });
  useLayoutEffect(() => {
    observe({ read, session, command: command.id, locate: (location, id) => setCommand({ location, id }) });
  });
  const observed: Controller = {
    ...read,
    readingEntry: {
      ...read.readingEntry,
      positioned() {
        onPositioned(command.id);
        read.readingEntry.positioned();
      }
    }
  };
  return (
    <View style={{ flex: 1 }}>
      <TopicContentList
        actions={actions}
        article={{ busy: read.topicBusy, error: read.topicError, topic: read.topicDetail }}
        commentSearchFocused={false}
        currentNodeSeekUser={undefined}
        discourseEmojiUrls={{}}
        headerError={null}
        html={{ ...html, contentWidth: 340, mediaSessionIdentity: `reading-proof:${detail.id}` }}
        nodeSeekUserId={null}
        onImagePreviewDescriptors={noop}
        onCommentSearchFocusChange={noop}
        onOpenTopic={noop}
        onOpenUser={noop}
        onScrollProgress={onNativeScroll}
        read={observed}
        session={session}
        location={read.readingEntry.location}
        locationRequestId={command.id}
        topicScrollRef={list}
      />
    </View>
  );
}

/** Runs inside the existing remediation proof/providers, never a standalone model harness. */
export async function verifyReadingEntryProof(
  mode: 'cold' | 'cached',
  {
    mount,
    until,
    baseGateway,
    requestOrder,
    metrics
  }: {
    mount: (node: ReactNode) => void;
    until: (test: () => unknown, message: string) => Promise<void>;
    baseGateway: ReadGateway;
    requestOrder: (action: ReadingProofAction | undefined) => Promise<void>;
    metrics: Record<string, unknown>;
  }
) {
  const report: ProofMetrics = { mode, positions: [], native: [], commands: [], orders: [], localSends: 0 };
  metrics.reading = report;
  const control: Control = { hold: true, command: 1, nativeRef: null, held: [], metrics: report };
  const list = controlledRef(control);
  const topicGate = barrier(),
    registrationGate = barrier(),
    windowGate = barrier();
  let topicCalls = 0,
    registrations = 0,
    replyCalls = 0;
  const detail = prepareTopicContent({
    source: 'linuxdo',
    id: mode === 'cold' ? '9700601' : '9700602',
    title: `隔离阅读入口 ${mode}`,
    author: 'proof',
    createdAt: '2026-09-10T00:00:00Z',
    url: 'https://reading.invalid/controlled',
    replyCount: 39,
    replyCompleteness: 'partial',
    replies: [],
    contentHtml: Array.from({ length: 32 }, (_, i) => `<p>受控主楼段落 ${i}，原生排版保持真实。</p>`).join('')
  });
  const reading = createDiscourseReadingRuntime({
    queryClient: appQueryClient,
    scope: () => `reading-proof-${mode}`,
    send: async () => {
      report.localSends += 1;
    }
  });
  const snapshot = { topicId: detail.id, lastReadPostNumber: 15, highestPostNumber: 40 };
  const observe = () => reading.observe([snapshot], reading.startRequest());
  const replies = Array.from({ length: 39 }, (_, i) => ({
    author: `proof${i}`,
    commentId: 97006000 + i,
    floor: i + 2,
    createdAt: '2026-09-10T00:01:00Z',
    contentHtml: `<p>隔离回复楼层 ${i + 2}。真实列表的原生行。</p>`
  }));
  const gateway: ReadGateway = {
    ...baseGateway,
    reading,
    async getTopic() {
      topicCalls += 1;
      await topicGate.promise;
      observe();
      return detail;
    },
    async getTopicReading() {
      registrations += 1;
      await registrationGate.promise;
      observe();
      return snapshot;
    },
    async getReplies({ order }) {
      replyCalls += 1;
      await windowGate.promise;
      return prepareRepliesContent(
        {
          items: order === 'newest' ? [...replies].reverse() : replies,
          hasMore: false,
          nextPage: null,
          previousPage: null,
          currentPage: 1,
          completeness: 'complete',
          totalCount: 39
        },
        'linuxdo',
        detail.id
      );
    },
    getReply: unexpected
  };
  const topicQuery = forumQueryKeys.topic({
    source: 'linuxdo',
    topicId: detail.id,
    readPlanScope: gateway.getReadPlan('linuxdo', 'topic').cacheScope,
    scope: initialForumSessionEpochs
  });
  if (mode === 'cached') {
    observe();
    appQueryClient.setQueryData(topicQuery, detail);
  }
  const current = () => {
    check(control.current, 'Real reading controller not committed');
    return control.current;
  };
  const native = () => {
    check(control.nativeRef, 'Real FlashList not mounted');
    return control.nativeRef;
  };
  const lastNative = () => {
    const value = report.native.at(-1);
    check(value, 'No accepted Native scroll receipt');
    return value;
  };
  const visiblePixel = (index: number) => {
    const layout = native().getLayout(index);
    if (!layout || layout.height <= 0) return Number.NaN;
    return native().getFirstItemOffset() + layout.y - lastNative().offset;
  };
  async function releaseLatest(command: number) {
    const held = control.held.filter((item) => item.command === command).at(-1);
    check(held, `No physical command held for ${command}`);
    control.hold = false;
    try {
      await held.invoke();
    } finally {
      held.finish();
    }
    return held;
  }
  try {
    mount(
      <ReadingProbe
        observe={({ read, session, command, locate }) => {
          control.current = { read, session };
          control.command = command;
          control.locate = locate;
        }}
        onPositioned={(command) => report.positions.push({ command, at: performance.now() })}
        onNativeScroll={(event) => {
          const value = event.nativeEvent;
          if (value.layoutMeasurement.height <= 0) return;
          report.native.push({
            at: performance.now(),
            timestamp: event.timeStamp,
            offset: value.contentOffset.y,
            height: value.layoutMeasurement.height,
            contentHeight: value.contentSize.height
          });
        }}
        detail={detail}
        gateway={gateway}
        list={list}
      />
    );
    await until(
      () => control.current && (mode === 'cold' ? topicCalls === 1 : registrations === 1),
      'Entry request not admitted'
    );
    if (mode === 'cold')
      check(!current().read.readingEntry.ready, 'Cold decision completed before controlled source input');
    topicGate.release();
    registrationGate.release();
    await until(
      () => control.current?.read.readingEntry.ready && replyCalls > 0,
      'Reading decision did not request target window'
    );
    check(
      !current().read.readingEntry.windowReady && !current().read.readingEntry.positionReady,
      'Decision completion impersonated reply window or Native position'
    );
    report.entry = { ready: true, windowReady: false, positionReady: false, registrations };
    windowGate.release();
    await until(
      () => control.current?.read.readingEntry.windowReady && control.held.length > 0 && control.nativeRef,
      'Target window never reached physical scroll boundary'
    );
    await nextFrame();
    await nextFrame();
    check(
      !current().read.readingEntry.positionReady && report.positions.length === 0,
      'Loaded reply window completed position before real Native scroll'
    );
    const host = findNodeHandle(native().getNativeScrollRef());
    check(host, 'Missing real Native list host');
    report.nativeHost = host;
    report.windowBeforeNative = { heldCommands: control.held.length, positionReady: false };
    const first = await releaseLatest(1);
    await until(
      () =>
        current().read.readingEntry.positionReady &&
        report.positions.some((item) => item.command === 1) &&
        report.native.length > 0,
      'Real Native positioning did not finish entry'
    );
    check(
      visiblePixel(first.params.index) >= -1 && visiblePixel(first.params.index) < lastNative().height,
      'Entry completed outside real Native viewport'
    );
    const oldOffset = lastNative().offset;

    // Reflow the real opening above the same target. Do not fabricate an onScroll event.
    appQueryClient.setQueryData(
      topicQuery,
      prepareTopicContent({
        ...detail,
        contentHtml: detail.contentHtml + Array.from({ length: 100 }, (_, i) => `<p>新增排版段落 ${i}。</p>`).join('')
      })
    );
    const prior = report.native.length;
    native().scrollToOffset({ offset: 0, animated: false });
    await until(
      () => report.native.length > prior && lastNative().offset <= 1,
      'Native opening scroll did not acknowledge'
    );
    control.hold = true;
    control.locate?.({ kind: 'reply', target: { floor: 16 } }, 2);
    await until(() => control.held.some((item) => item.command === 2), 'Same floor new command was not admitted');
    const second = control.held.filter((item) => item.command === 2).at(-1)!;
    await until(
      () => visiblePixel(second.params.index) > lastNative().height + oldOffset,
      'Real reflow did not separate obsolete offset'
    );
    const beforeObsolete = report.native.length;
    native().scrollToOffset({ offset: oldOffset, animated: false });
    await until(
      () => report.native.length > beforeObsolete && Math.abs(lastNative().offset - oldOffset) <= 1,
      'Obsolete physical offset was not acknowledged by Native'
    );
    await nextFrame();
    const completed = report.positions.filter((item) => item.command === 2).length;
    const pixel = visiblePixel(second.params.index);
    check(
      pixel >= lastNative().height && completed === 0,
      'Old-layout Native acknowledgement completed the new command'
    );
    report.obsoleteOffset = { old: oldOffset, currentPixel: pixel, height: lastNative().height, completed };
    await releaseLatest(2);
    await until(
      () =>
        report.positions.some((item) => item.command === 2) &&
        visiblePixel(second.params.index) >= -1 &&
        visiblePixel(second.params.index) < lastNative().height,
      'New command did not reach actual target'
    );
    report.finalTarget = {
      command: 2,
      index: second.params.index,
      pixel: visiblePixel(second.params.index),
      height: lastNative().height
    };

    for (const [index, order] of (['newest', 'oldest'] as const).entries()) {
      const oldOrder = current().session.state.replyOrder;
      // Reply controls are a recyclable row, not a sticky header. Reach the real
      // trigger before asking agent-device to click it; find never scrolls for us.
      const controlsIndex = native().props.data?.findIndex((item) => item.type === 'replyControls') ?? -1;
      check(controlsIndex >= 0, 'Production reply controls not present');
      const controlsVisible = visiblePixel(controlsIndex) >= -1 && visiblePixel(controlsIndex) < lastNative().height;
      const menuScrollAt = performance.now();
      await native().scrollToIndex({ index: controlsIndex, animated: false });
      await until(
        () =>
          (controlsVisible || lastNative().at >= menuScrollAt) &&
          visiblePixel(controlsIndex) >= -1 &&
          visiblePixel(controlsIndex) < lastNative().height,
        'Production reply controls did not reach real Native viewport'
      );
      const commandCount = report.commands.length;
      // The existing runner presses the actual production menu; no direct setter bypass.
      await requestOrder({ id: `${mode}-${index + 1}`, from: oldOrder, to: order });
      await until(
        () => control.current?.session.state.replyOrder === order && !current().read.repliesLoading,
        'Actual reply-order menu did not settle'
      );
      await until(() => report.commands.length > commandCount, 'Production order coordinator did not issue its scroll');
      const scroll = report.commands.at(-1)!;
      await until(
        () =>
          lastNative().at >= scroll.at &&
          visiblePixel(scroll.index) >= -1 &&
          visiblePixel(scroll.index) < lastNative().height,
        'Sorted reply boundary did not reach actual Native viewport'
      );
      const firstFloor = current().read.topicReplies[0]?.floor;
      check(firstFloor === (order === 'newest' ? 40 : 2), 'Sorted gateway window was not rendered in source order');
      check(findNodeHandle(native().getNativeScrollRef()) === host, 'Sorting replaced Native list host');
      check(lastNative().height > 0 && Number.isFinite(lastNative().offset), 'Sorting lost Native viewport');
      report.orders.push({
        order,
        firstFloor,
        nativeHost: findNodeHandle(native().getNativeScrollRef()),
        offset: lastNative().offset,
        anchorIndex: scroll.index,
        pixel: visiblePixel(scroll.index),
        height: lastNative().height,
        uiAcknowledged: true
      });
      await requestOrder(undefined);
    }
    check(mode !== 'cached' || registrations === 1, 'Cached entry registered more than once');
    check(
      [...report.positions].length === 2 &&
        [1, 2].every((command) => report.positions.filter((item) => item.command === command).length === 1),
      'A reading command completed more than once'
    );
  } catch (error) {
    const read = control.current?.read;
    const location = read?.readingEntry.location;
    const target = location?.kind === 'reply' ? location.target : undefined;
    const query = appQueryClient.getQueryState(
      forumQueryKeys.replies(
        topicQuery,
        control.current?.session.state.replyOrder || 'oldest',
        gateway.getReadPlan('linuxdo', 'replies').cacheScope
      )
    );
    report.failureState = {
      command: control.command,
      location,
      ready: read?.readingEntry.ready,
      windowReady: read?.readingEntry.windowReady,
      positionReady: read?.readingEntry.positionReady,
      topicLoaded: Boolean(read?.topicDetail),
      topicBusy: read?.topicBusy,
      repliesLoading: read?.repliesLoading,
      replyCount: read?.topicReplies.length || 0,
      replyCalls,
      topicCalls,
      registrations,
      listAttached: Boolean(control.nativeRef),
      targetIndex: target
        ? (control.nativeRef?.props.data?.findIndex(
            (item) =>
              'reply' in item &&
              (target.commentId !== undefined
                ? item.reply.commentId === target.commentId
                : item.reply.floor === target.floor)
          ) ?? -1)
        : -1,
      heldCommands: control.held.length,
      replyQuery: query
        ? { status: query.status, fetchStatus: query.fetchStatus, isInvalidated: query.isInvalidated }
        : undefined
    };
    throw error;
  } finally {
    try {
      await requestOrder(undefined);
    } finally {
      topicGate.release();
      registrationGate.release();
      windowGate.release();
      mount(null);
      await nextFrame();
      control.held.forEach((item) => item.finish());
      reading.dispose();
      await appQueryClient.cancelQueries({ queryKey: topicQuery });
      appQueryClient.removeQueries({ queryKey: topicQuery });
    }
  }
}
