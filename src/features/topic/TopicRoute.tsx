import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef } from 'react';
import { Linking, Share, type NativeScrollEvent, type NativeSyntheticEvent, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FlashListRef } from '@shopify/flash-list';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import type { Fetcher } from '@/platform/network/request';
import { errorMessage } from '@/platform/network/errors';
import { isHttpOrHttpsUrl } from '@/platform/media/imageRequestSource';
import { useForumMediaSessionIdentity } from '@/platform/media/mediaSessionEpoch';
import { OriginalImageUpgradeBoundary } from '@/platform/media/originalImageLoading';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { ReadGateway } from '@/sources/readGateway';
import { toggleFavorite, type ReaderData, type ReaderDataMutationReason } from '@/domain/reader/readerData';
import { projectContentSourcePreferences } from '@/domain/reader/contentSourcePreferences';
import type { ReplyLocationTarget, Topic, UserReference } from '@/domain/forum/models';
import type { DiscourseSource, SessionSource } from '@/domain/forum/sourceCatalog';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import type { WritableSessionTicket } from '@/domain/session/writableSessionGate';
import type { ReaderStyleContextValue } from '@/ui/theme/ReaderStyleProvider';
import { ImagePreviewModal } from '@/ui/media/ImagePreviewModal';
import { useCommitRefValue } from '@/ui/hooks/useCommittedRef';
import { useLatestCallback } from '@/ui/hooks/useLatestCallback';
import { manageContentSourcesAction } from '@/ui/navigation/appRouteActions';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { ContentSourceDisabledState } from '@/ui/controls/FeedbackStates';
import { useTopicActionsController } from './actions/useTopicActionsController';
import { useImagePreviewController } from './media/useImagePreviewController';
import { verifyLinuxDoTopic } from './model/topicVerification';
import { useHtmlRenderingController } from './rendering/useHtmlRenderingController';
import { shareTopicWithClipboardFallback } from './shareTopic';
import { TopicScreen } from './TopicScreen';
import type { TopicListItem } from './model/topicListModel';
import { useStableTopicLayoutDetail } from './useStableTopicLayoutDetail';
import { useTopicController } from './useTopicController';
import { useTopicSessionController } from './useTopicSessionController';
import { useTopicRouteBeforeRemove } from './useTopicRouteBeforeRemove';

export type TopicRouteRuntimeValue = {
  account: {
    sessionEpochs: ForumSessionEpochs;
    sessionViewModels: SiteSessionViewModels;
    ensureNodeImageApiKey: () => Promise<string | null>;
    ensureWritableSession: (source: SessionSource) => Promise<WritableSessionTicket>;
    isWritableSessionTicketCurrent: (ticket: WritableSessionTicket) => boolean;
    getLinuxDoUserAgent: () => string;
    linuxDoVerificationVisible: boolean;
    getNodeSeekUserAgent: () => string;
    nodeSeekUserId: number | null;
    onSessionExpired: (source: SessionSource, requestSessionEpoch: number) => void;
    readGateway: ReadGateway;
    reconcileAccountStatus: (source: SessionSource) => Promise<unknown>;
    requestNodeSeekVerification: (message: string, recovery: LinuxDoReadRecovery) => void;
    showLinuxDoVerification: (
      message?: string,
      recovery?: LinuxDoReadRecovery
    ) => void | boolean | Promise<void | boolean>;
    showYaohuoLogin: (message?: string) => void;
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

type TopicRouteProps = NativeStackScreenProps<RootStackParamList, 'Topic'>;

export function TopicRoute({ navigation, route }: TopicRouteProps) {
  const runtime = useTopicRouteRuntime();
  const topic = route.params.topic;
  const sourceEnabled = projectContentSourcePreferences(
    runtime.reader.data.settings.contentSources
  ).enabledSources.includes(topic.source);
  if (!sourceEnabled) {
    return (
      <ContentSourceDisabledState
        source={topic.source}
        onBack={navigation.goBack}
        onManage={() => navigation.dispatch(manageContentSourcesAction())}
      />
    );
  }
  return <EnabledTopicRoute navigation={navigation} route={route} runtime={runtime} />;
}

function EnabledTopicRoute({ navigation, route, runtime }: TopicRouteProps & { runtime: TopicRouteRuntimeValue }) {
  const active = useIsFocused();
  const topic = route.params.topic;
  const toggleTopicFavorite = useCallback(
    () => runtime.reader.commit('favorite-toggled', (current) => toggleFavorite(current, topic)),
    [runtime.reader, topic]
  );
  const topicScrollRef = useRef<FlashListRef<TopicListItem> | null>(null);
  const targetReplyRequestIdRef = useRef(route.params.targetReplyRequestId ?? 0);
  const topicSession = useTopicSessionController({ notify: runtime.notify, topic });
  const {
    state: { replyComposerIntent, selectedTopic },
    commands: { composer: topicComposer, view: topicView }
  } = topicSession;
  const openTopicRoute = useCallback(
    (nextTopic: Topic, targetReply?: ReplyLocationTarget) =>
      navigation.push('Topic', { topic: nextTopic, targetReply }),
    [navigation]
  );
  const topicController = useTopicController({
    active,
    commitReaderData: runtime.reader.commit,
    sessionEpochs: runtime.account.sessionEpochs,
    notify: runtime.notify,
    onRetryIdentityStatus: runtime.account.reconcileAccountStatus,
    onNodeSeekTopicVerificationRequired: runtime.account.requestNodeSeekVerification,
    onOpenTopic: openTopicRoute,
    readerData: runtime.reader.data,
    readerDataRef: runtime.reader.dataRef,
    showLinuxDoVerification: runtime.account.showLinuxDoVerification,
    showYaohuoLogin: runtime.account.showYaohuoLogin,
    readGateway: runtime.account.readGateway,
    targetReply: route.params.targetReply,
    targetReplyRequestId: route.params.targetReplyRequestId,
    topic,
    topicSession
  });
  const {
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
  const openTopicDestination = useCallback(
    (nextTopic: Topic, targetReply?: ReplyLocationTarget) => {
      if (!targetReply) {
        void openTopic(nextTopic);
        return;
      }
      if (nextTopic.source === topic.source && nextTopic.id === topic.id) {
        topicView.changeCommentQuery('');
        topicView.changeReplyFilter('all');
        targetReplyRequestIdRef.current =
          Math.max(targetReplyRequestIdRef.current, route.params.targetReplyRequestId ?? 0) + 1;
        navigation.setParams({ targetReply, targetReplyRequestId: targetReplyRequestIdRef.current });
        return;
      }
      openTopicRoute(nextTopic, targetReply);
    },
    [navigation, openTopic, openTopicRoute, route.params.targetReplyRequestId, topic.id, topic.source, topicView]
  );
  const topicLayoutDetail = useStableTopicLayoutDetail(topicDetail);
  const mediaSessionIdentity = useForumMediaSessionIdentity(topic.source);
  const openExternalUrl = useCallback(
    (url: string) => {
      if (!isHttpOrHttpsUrl(url)) {
        runtime.notify('仅支持打开 http/https 链接。');
        return;
      }
      void WebBrowser.openBrowserAsync(url).catch((error) => runtime.notify(errorMessage(error)));
    },
    [runtime]
  );
  const openOriginalUrl = useCallback(
    (url: string) => {
      if (!isHttpOrHttpsUrl(url)) {
        runtime.notify('仅支持打开 http/https 链接。');
        return;
      }
      void Linking.openURL(url).catch((error) => runtime.notify(errorMessage(error)));
    },
    [runtime]
  );
  const openImagePreviewRef = useRef<Parameters<typeof useHtmlRenderingController>[0]['onOpenImagePreview']>(
    () => undefined
  );
  const html = useHtmlRenderingController({
    mediaSessionIdentity,
    onOpenExternalUrl: openExternalUrl,
    onOpenImagePreview: (url, displaySize, posterUri, referrerPolicy) =>
      openImagePreviewRef.current(url, displaySize, posterUri, referrerPolicy),
    onOpenTopic: openTopicDestination,
    onOpenUser: (user) => navigation.push('User', { user }),
    nodeSeekMediaUserAgent: runtime.nodeSeekMediaUserAgent,
    selectedTopic,
    settings: runtime.reader.data.settings,
    styleSettings: runtime.readerStyle.settings,
    theme: runtime.readerStyle.theme,
    topicDetail: topicLayoutDetail,
    topicKey: `${topic.source}:${topic.id}`,
    webViewBlockMessage: runtime.networkProxyWebViewBlockMessage
  });
  const imagePreviewController = useImagePreviewController({
    beforeSave: runtime.ensureNetworkProxyReady,
    contentSource: topic.source,
    contentWidth: runtime.contentWidth,
    fetcher: runtime.fetcher,
    inlineSizedImageUrls: html.inlineSizedImageUrls,
    mediaReferrer: html.mediaContext?.referrer,
    nodeSeekMediaUserAgent: runtime.nodeSeekMediaUserAgent,
    notify: runtime.notify,
    topicImageDeriver: html.topicImageDeriver
  });
  useCommitRefValue(openImagePreviewRef, imagePreviewController.openImagePreview);
  const discourseActionRuntimeDependencies = useMemo(
    () => ({
      linuxDoUserAgent: runtime.account.getLinuxDoUserAgent
    }),
    [runtime]
  );
  const actions = useTopicActionsController({
    active,
    sessionEpochs: runtime.account.sessionEpochs,
    discourseActionRuntimeDependencies,
    discourseLoginPrompts: {
      linuxdo: runtime.account.showLinuxDoVerification
    } satisfies Record<DiscourseSource, (message?: string) => void>,
    ensureWritableSession: runtime.account.ensureWritableSession,
    fetcher: runtime.fetcher,
    isWritableSessionTicketCurrent: runtime.account.isWritableSessionTicketCurrent,
    getNodeSeekUserAgent: runtime.account.getNodeSeekUserAgent,
    ensureNodeImageApiKey: runtime.account.ensureNodeImageApiKey,
    notify: runtime.notify,
    onSessionExpired: runtime.account.onSessionExpired,
    readGateway: runtime.account.readGateway,
    refreshTopicReplies,
    siteSessionViewModels: runtime.account.sessionViewModels,
    topicDetail,
    topicReplies,
    topicSession
  });
  const closeReplyComposer = useCallback(() => topicComposer.toggle(false), [topicComposer]);
  useTopicRouteBeforeRemove({
    imagePreviewOpen: Boolean(imagePreviewController.imagePreview),
    replyComposerOpen: replyComposerIntent.kind !== 'closed',
    closeImagePreview: imagePreviewController.closeImagePreview,
    closeReplyComposer
  });
  const refreshCurrentTopic = useCallback(() => {
    void refreshWholeTopic();
  }, [refreshWholeTopic]);
  const verifyLinuxDo = useCallback(
    () =>
      verifyLinuxDoTopic({
        identityPending: false,
        refreshTopic: (current) => openTopic(current, true),
        selectedTopic,
        showVerification: () => Promise.resolve(runtime.account.showLinuxDoVerification()),
        topicDetail
      }),
    [openTopic, runtime, selectedTopic, topicDetail]
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
  const stableOpenTopic = useLatestCallback(openTopicDestination);
  const stableOpenUser = useLatestCallback((user: UserReference) => navigation.push('User', { user }));
  const stableRefreshReplies = useLatestCallback(refreshTopicReplies);
  const stableRefreshWholeTopic = useLatestCallback(refreshCurrentTopic);
  return (
    <OriginalImageUpgradeBoundary enabled={active}>
      <View
        accessibilityElementsHidden={!active}
        importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
        pointerEvents={active ? 'auto' : 'none'}
        style={{ flex: 1 }}
      >
        <TopicScreen
          active={active}
          actions={actions}
          article={{
            busy: topicBusy,
            error: topicError || null,
            topic: topicLayoutDetail,
            ...(topicDetail?.source === 'yaohuo' ? { yaohuoBookmarked: topicDetail.bookmarked } : {})
          }}
          chrome={{
            back: navigation.goBack,
            favorite: topicFavorite,
            getDiscourseEmojiUrls: runtime.account.readGateway.getEmojiUrls,
            onScroll: handleTopicScroll,
            openOriginal: openOriginalUrl,
            openReadingSettings: () => navigation.push('ReadingSettings'),
            openTopic: stableOpenTopic,
            openUser: stableOpenUser,
            refreshReplies: stableRefreshReplies,
            refreshTopic: stableRefreshWholeTopic,
            share: shareTopic,
            toggleFavorite: toggleTopicFavorite,
            verifyLinuxDo,
            verifyNodeSeek
          }}
          currentNodeSeekUser={runtime.account.sessionViewModels.nodeseek.currentUser}
          bodyMediaPaused={Boolean(imagePreviewController.imagePreview)}
          html={{ ...html, contentWidth: runtime.contentWidth, mediaSessionIdentity }}
          nodeSeekUserId={runtime.account.nodeSeekUserId}
          onImagePreviewDescriptors={imagePreviewController.registerImagePreviewDescriptors}
          read={topicController}
          session={topicSession}
          targetReply={route.params.targetReply}
          targetReplyRequestId={route.params.targetReplyRequestId}
          topicScrollRef={topicScrollRef}
        />
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
