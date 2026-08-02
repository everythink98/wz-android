import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef } from 'react';
import { Linking, Share, type NativeScrollEvent, type NativeSyntheticEvent, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FlashListRef } from '@shopify/flash-list';
import * as Clipboard from 'expo-clipboard';
import type { Fetcher } from '@/platform/network/request';
import { errorMessage } from '@/platform/network/errors';
import { isHttpOrHttpsUrl } from '@/platform/media/imageRequestSource';
import { type ImageDisplaySize } from '@/platform/media/imagePreviewCatalog';
import { mediaSessionIdentityForSource } from '@/platform/media/mediaSessionEpoch';
import { OriginalImageUpgradeBoundary } from '@/platform/media/originalImageLoading';
import type { ForumIdentityBarrierSource } from '@/platform/query/serverState';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { ReadGateway } from '@/sources/readGateway';
import type { DiscourseActionRuntimeDependencies } from './actions/discourseActionRuntime';
import { toggleFavorite, type ReaderData, type ReaderDataMutationReason } from '@/domain/reader/readerData';
import type { SourceErrorInfo, Topic, UserReference } from '@/domain/forum/models';
import type { DiscourseSource, SessionSource } from '@/domain/forum/sourceCatalog';
import type { SiteSessionEvent, SiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import type { WritableSessionReconcileResult, WritableSessionTicket } from '@/domain/session/writableSessionGate';
import type { ReaderStyleContextValue } from '@/ui/theme/ReaderStyleProvider';
import { ImagePreviewModal } from '@/ui/media/ImagePreviewModal';
import { useCommitRefValue } from '@/ui/hooks/useCommittedRef';
import { useLatestCallback } from '@/ui/hooks/useLatestCallback';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { useIdentityVerificationPrompt } from '@/ui/hooks/useIdentityVerificationPrompt';
import { useTopicActionsController } from './actions/useTopicActionsController';
import { useImagePreviewController } from './media/useImagePreviewController';
import { replyHtmlWithSignature } from './model/topicDerivedData';
import { verifyLinuxDoTopic } from './model/topicVerification';
import { useHtmlRenderingController } from './rendering/useHtmlRenderingController';
import { shareTopicWithClipboardFallback } from './shareTopic';
import { TopicScreen } from './TopicScreen';
import type { TopicListItem } from './model/topicListModel';
import { useStableTopicLayoutDetail } from './useStableTopicLayoutDetail';
import { useTopicController } from './useTopicController';
import { useTopicSessionController } from './useTopicSessionController';
import { useTopicRouteBeforeRemove } from './useTopicRouteBeforeRemove';
import { useTopicPresentation } from './useTopicPresentation';

type IdentityCheck = {
  checking: boolean;
  pending: boolean;
  error?: SourceErrorInfo;
};

export type TopicRouteRuntimeValue = {
  account: {
    identityBarriers: readonly ForumIdentityBarrierSource[];
    identityChecks: Record<SessionSource, IdentityCheck>;
    beginXiaoyinsiAuthorization: () => Promise<unknown>;
    sessionEpochs: ForumSessionEpochs;
    sessionViewModels: SiteSessionViewModels;
    ensureNodeImageApiKey: () => Promise<string | null>;
    ensureWritableSession: (source: SessionSource) => Promise<WritableSessionTicket>;
    isWritableSessionTicketCurrent: (ticket: WritableSessionTicket) => boolean;
    getLinuxDoUserAgent: () => string;
    linuxDoVerificationVisible: boolean;
    getNodeSeekUserAgent: () => string;
    nodeSeekUserId: number | null;
    readGateway: ReadGateway;
    reconcileAccountStatus: (source: SessionSource) => Promise<unknown>;
    reconcileWritableSession: (source: SessionSource) => Promise<WritableSessionReconcileResult>;
    refreshXiaoyinsiAuthorization: DiscourseActionRuntimeDependencies['refreshXiaoyinsiAuthorization'];
    requestNodeSeekVerification: (message: string, recovery: LinuxDoReadRecovery) => void;
    resetLinuxDoLevelState: () => void;
    showLinuxDoVerification: (
      message?: string,
      recovery?: LinuxDoReadRecovery
    ) => void | boolean | Promise<void | boolean>;
    showYaohuoLogin: (message?: string) => void;
    updateLinuxDoSession: (event: SiteSessionEvent) => void;
  };
  appActive: boolean;
  contentWidth: number;
  ensureNetworkProxyReady: () => Promise<void>;
  fetcher: Fetcher;
  networkProxyWebViewBlockMessage: string;
  nodeSeekMediaUserAgent: string;
  notify: (message: string) => void;
  reader: {
    commit: (reason: ReaderDataMutationReason, updater: (current: ReaderData) => ReaderData) => void;
    data: ReaderData;
    dataRef: { current: ReaderData };
  };
  readerStyle: ReaderStyleContextValue;
};

const TopicRouteRuntimeContext = createContext<TopicRouteRuntimeValue | null>(null);

export function TopicRouteRuntimeProvider({ children, value }: { children: ReactNode; value: TopicRouteRuntimeValue }) {
  return <TopicRouteRuntimeContext.Provider value={value}>{children}</TopicRouteRuntimeContext.Provider>;
}

function useTopicRouteRuntime() {
  const runtime = useContext(TopicRouteRuntimeContext);
  if (!runtime) throw new Error('TopicRouteRuntimeProvider is required');
  return runtime;
}

export function TopicRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Topic'>) {
  const runtime = useTopicRouteRuntime();
  const active = useIsFocused();
  const topic = route.params.topic;
  const toggleTopicFavorite = useCallback(
    () => runtime.reader.commit('favorite-toggled', (current) => toggleFavorite(current, topic)),
    [runtime.reader, topic]
  );
  const topicScrollRef = useRef<FlashListRef<TopicListItem> | null>(null);
  const topicSession = useTopicSessionController({ notify: runtime.notify, topic });
  const {
    state: { replyComposerOpen, selectedTopic },
    commands: { composer: topicComposer, view: topicView }
  } = topicSession;
  const openTopicRoute = useCallback(
    (nextTopic: Topic) => navigation.push('Topic', { topic: nextTopic }),
    [navigation]
  );
  const topicController = useTopicController({
    active,
    commitReaderData: runtime.reader.commit,
    identityBarriers: runtime.account.identityBarriers,
    sessionEpochs: runtime.account.sessionEpochs,
    notify: runtime.notify,
    onNodeSeekTopicVerificationRequired: runtime.account.requestNodeSeekVerification,
    onOpenTopic: openTopicRoute,
    readerData: runtime.reader.data,
    readerDataRef: runtime.reader.dataRef,
    showLinuxDoVerification: runtime.account.showLinuxDoVerification,
    showYaohuoLogin: runtime.account.showYaohuoLogin,
    readGateway: runtime.account.readGateway,
    topic,
    topicSession
  });
  const {
    loadedQuotedReplies,
    openTopic,
    refreshTopicReplies,
    refreshWholeTopic,
    topicBusy,
    topicDetail,
    topicError,
    topicFavorite,
    topicQueryKey,
    topicReplies
  } = topicController;
  const topicLayoutDetail = useStableTopicLayoutDetail(topicDetail);
  const identityCheck = topic.source === 'linuxdo' ? runtime.account.identityChecks.linuxdo : undefined;
  const identityError = identityCheck?.pending ? identityCheck.error : undefined;
  const mediaSessionIdentity = mediaSessionIdentityForSource(topic.source, runtime.account.sessionEpochs);
  const openExternalUrl = useCallback(
    (url: string) => {
      if (!isHttpOrHttpsUrl(url)) {
        runtime.notify('仅支持打开 http/https 链接。');
        return;
      }
      void Linking.openURL(url).catch((error) => runtime.notify(errorMessage(error)));
    },
    [runtime]
  );
  const openImagePreviewRef = useRef<(url: string, displaySize?: ImageDisplaySize, renderedPosterUri?: string) => void>(
    () => undefined
  );
  const html = useHtmlRenderingController({
    mediaSessionIdentity,
    onOpenExternalUrl: openExternalUrl,
    onOpenImagePreview: (url, displaySize, posterUri) => openImagePreviewRef.current(url, displaySize, posterUri),
    onOpenTopic: (nextTopic) => {
      void openTopic(nextTopic);
    },
    onOpenUser: (user) => navigation.push('User', { user }),
    nodeSeekMediaUserAgent: runtime.nodeSeekMediaUserAgent,
    selectedTopic,
    settings: runtime.reader.data.settings,
    styleSettings: runtime.readerStyle.settings,
    theme: runtime.readerStyle.theme,
    topicDetail,
    topicKey: `${topic.source}:${topic.id}`,
    webViewBlockMessage: runtime.networkProxyWebViewBlockMessage
  });
  const getTopicHtmlParts = useCallback(
    () =>
      [
        topicDetail?.contentHtml || '',
        ...topicReplies.map(replyHtmlWithSignature),
        ...Object.values(loadedQuotedReplies).map(replyHtmlWithSignature)
      ].filter(Boolean),
    [loadedQuotedReplies, topicDetail?.contentHtml, topicReplies]
  );
  const imagePreviewController = useImagePreviewController({
    beforeSave: runtime.ensureNetworkProxyReady,
    contentSource: topic.source,
    contentWidth: runtime.contentWidth,
    fetcher: runtime.fetcher,
    htmlParts: getTopicHtmlParts,
    inlineSizedImageUrls: html.inlineSizedImageUrls,
    nodeSeekMediaUserAgent: runtime.nodeSeekMediaUserAgent,
    notify: runtime.notify,
    topicImageDeriver: html.topicImageDeriver
  });
  useCommitRefValue(openImagePreviewRef, imagePreviewController.openImagePreview);
  const discourseActionRuntimeDependencies = useMemo(
    () => ({
      linuxDoUserAgent: runtime.account.getLinuxDoUserAgent,
      refreshXiaoyinsiAuthorization: runtime.account.refreshXiaoyinsiAuthorization,
      resetLinuxDoLevelState: runtime.account.resetLinuxDoLevelState,
      updateLinuxDoSession: runtime.account.updateLinuxDoSession
    }),
    [runtime]
  );
  const actions = useTopicActionsController({
    active,
    sessionEpochs: runtime.account.sessionEpochs,
    discourseActionRuntimeDependencies,
    discourseLoginPrompts: {
      linuxdo: runtime.account.showLinuxDoVerification,
      xiaoyinsi: (message) => {
        runtime.notify(message || '匿名可阅读，授权后才能互动。');
        void runtime.account.beginXiaoyinsiAuthorization();
      }
    } satisfies Record<DiscourseSource, (message?: string) => void>,
    ensureWritableSession: runtime.account.ensureWritableSession,
    fetcher: runtime.fetcher,
    isWritableSessionTicketCurrent: runtime.account.isWritableSessionTicketCurrent,
    getNodeSeekUserAgent: runtime.account.getNodeSeekUserAgent,
    ensureNodeImageApiKey: runtime.account.ensureNodeImageApiKey,
    notify: runtime.notify,
    reconcileWritableSession: runtime.account.reconcileWritableSession,
    refreshTopicReplies,
    siteSessionViewModels: runtime.account.sessionViewModels,
    topicDetail,
    topicReplies,
    topicSession
  });
  useIdentityVerificationPrompt({
    enabled:
      active && runtime.appActive && !runtime.account.linuxDoVerificationVisible && !actions.actionBusy && !topicDetail,
    error: identityCheck?.error,
    identityPending: Boolean(identityCheck?.pending),
    intentKey: active && runtime.appActive && topic.source === 'linuxdo' ? `topic:${topic.id}` : null,
    showVerification: runtime.account.showLinuxDoVerification
  });
  const closeReplyComposer = useCallback(() => topicComposer.toggle(false), [topicComposer]);
  useTopicRouteBeforeRemove({
    imagePreviewOpen: Boolean(imagePreviewController.imagePreview),
    replyComposerOpen,
    closeImagePreview: imagePreviewController.closeImagePreview,
    closeReplyComposer
  });
  const refreshCurrentTopic = useCallback(() => {
    if (identityError) {
      void runtime.account.reconcileAccountStatus('linuxdo');
      return;
    }
    void refreshWholeTopic();
  }, [identityError, refreshWholeTopic, runtime]);
  const verifyLinuxDo = useCallback(
    () =>
      verifyLinuxDoTopic({
        identityPending: Boolean(identityCheck?.pending),
        refreshTopic: (current) => openTopic(current, true),
        selectedTopic,
        showVerification: () => Promise.resolve(runtime.account.showLinuxDoVerification()),
        topicDetail
      }),
    [identityCheck?.pending, openTopic, runtime, selectedTopic, topicDetail]
  );
  const verifyNodeSeek = useCallback(() => {
    if (topic.source !== 'nodeseek') return;
    runtime.account.requestNodeSeekVerification(topicError?.message || 'NodeSeek 需要完成 Cloudflare 验证', {
      queryKey: topicQueryKey,
      resume: refreshWholeTopic
    });
  }, [refreshWholeTopic, runtime, topic.source, topicError?.message, topicQueryKey]);
  const shareTopic = useCallback(async () => {
    const current = topicDetail || topic;
    await shareTopicWithClipboardFallback({
      copy: async () => {
        await Clipboard.setStringAsync(current.url);
      },
      notify: runtime.notify,
      share: async () => {
        await Share.share({ title: current.title, message: `${current.title}\n${current.url}`, url: current.url });
      }
    });
  }, [runtime.notify, topic, topicDetail]);
  const handleTopicScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => topicView.rememberScrollY(event.nativeEvent.contentOffset.y),
    [topicView]
  );
  const stableOpenTopic = useLatestCallback(openTopic);
  const stableOpenUser = useLatestCallback((user: UserReference) => navigation.push('User', { user }));
  const stableRefreshReplies = useLatestCallback(refreshTopicReplies);
  const stableRefreshWholeTopic = useLatestCallback(refreshCurrentTopic);
  const presentation = useTopicPresentation({
    actions,
    articleState: {
      busy: topicBusy && !identityError,
      error: identityError || topicError || null,
      topic: topicLayoutDetail,
      ...(topicDetail?.source === 'yaohuo' ? { yaohuoBookmarked: topicDetail.bookmarked } : {})
    },
    chrome: {
      back: navigation.goBack,
      favorite: topicFavorite,
      getDiscourseEmojiUrls: runtime.account.readGateway.getEmojiUrls,
      identityBlocked: Boolean(identityCheck?.pending),
      identityChecking: Boolean(identityCheck?.checking),
      onScroll: handleTopicScroll,
      openOriginal: openExternalUrl,
      openReadingSettings: () => navigation.push('ReadingSettings'),
      openTopic: stableOpenTopic,
      openUser: stableOpenUser,
      refreshReplies: stableRefreshReplies,
      refreshTopic: stableRefreshWholeTopic,
      share: shareTopic,
      toggleFavorite: toggleTopicFavorite,
      verifyLinuxDo,
      verifyNodeSeek
    },
    currentNodeSeekUser: runtime.account.sessionViewModels.nodeseek.currentUser,
    html: {
      ...html,
      contentWidth: runtime.contentWidth,
      mediaSessionIdentity
    },
    nodeSeekUserId: runtime.account.nodeSeekUserId,
    read: topicController,
    session: topicSession,
    topicScrollRef
  });

  return (
    <OriginalImageUpgradeBoundary enabled={active}>
      <View
        accessibilityElementsHidden={!active}
        importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
        pointerEvents={active ? 'auto' : 'none'}
        style={{ flex: 1 }}
      >
        <TopicScreen presentation={presentation} />
        <ImagePreviewModal
          preview={imagePreviewController.imagePreview}
          nodeSeekMediaUserAgent={runtime.nodeSeekMediaUserAgent}
          onClose={imagePreviewController.closeImagePreview}
          onSave={imagePreviewController.savePreviewImage}
          onSelect={imagePreviewController.selectPreviewImage}
        />
      </View>
    </OriginalImageUpgradeBoundary>
  );
}
