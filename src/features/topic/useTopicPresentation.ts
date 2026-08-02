import { useMemo, type RefObject } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import type { FlashListRef } from '@shopify/flash-list';
import type { OptimisticActionState, InteractionType } from '@/domain/forum/topicActionState';
import type { Reply, SourceErrorInfo, Topic, TopicDetail, TopicPoll, UserReference } from '@/domain/forum/models';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { DiscourseSource } from '@/domain/forum/sourceCatalog';
import type { DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import type {
  HtmlBaseStyle,
  HtmlClassesStyles,
  HtmlIgnoredStyles,
  HtmlRenderers,
  HtmlRenderersProps,
  HtmlTagsStyles
} from './rendering/types';
import type { TopicImageDeriver } from './model/topicDerivedData';
import type { ReplyEditTarget, ReplyFilter, ReplyTarget } from './model/types';
import type { ToggleReplyQuoteOptions, ToggleTopicBodyQuoteOptions } from '@/domain/forum/quotedPosts';
import type { TopicActionDecisionFor } from './actions/topicActionDecision';
import type { TopicSessionController } from './useTopicSessionController';
import type { useTopicController } from './useTopicController';
import { filterTopicSessionReplies } from './useTopicSessionController';
import { markCurrentNodeSeekOwnRepliesUnlikable } from './actions/actionHelpers';
import type { TopicListItem } from './model/topicListModel';

export type TopicContentPresentation = {
  article: {
    selectedTopic: Topic | null;
    topic: TopicDetail | null;
    busy: boolean;
    error: SourceErrorInfo | null;
    yaohuoBookmarked?: boolean;
  };
  rendering: {
    contentWidth: number;
    htmlBaseStyle: HtmlBaseStyle;
    htmlClassesStyles: HtmlClassesStyles;
    htmlIgnoredStyles: HtmlIgnoredStyles;
    htmlRenderers: HtmlRenderers;
    htmlRenderersProps: HtmlRenderersProps;
    htmlTagsStyles: HtmlTagsStyles;
    inlineSizedImageUrls: Record<string, true>;
    mediaSessionIdentity: string;
    topicImageDeriver: TopicImageDeriver;
  };
  replies: {
    commentQuery: string;
    expandedQuotes: Record<string, boolean>;
    filtered: Reply[];
    hasMore: boolean;
    loadingMore: boolean;
    loadingQuotedFloors: Record<string, boolean>;
    loadedQuotedReplies: Record<string, Reply>;
    query: string;
    quoteStateVersion: number;
    replyComposerOpen: boolean;
    replyFilter: ReplyFilter;
    source: Reply[];
    topicScrollRef: RefObject<FlashListRef<TopicListItem> | null>;
    unreadCount: number;
    changeCommentQuery: (value: string) => void;
    changeFilter: (filter: ReplyFilter) => void;
    loadMore: () => void;
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
    openComposer: (open: boolean) => void;
    replyToFloor: (reply: Reply) => void;
    toggleReplyQuote: (options: ToggleReplyQuoteOptions) => void;
    toggleTopicBodyQuote: (options: ToggleTopicBodyQuoteOptions) => void;
  };
  actions: {
    busy: boolean;
    decisionFor: TopicActionDecisionFor;
    optimistic: Record<string, OptimisticActionState>;
    deleteReply: (reply: Reply) => void;
    editReply: (reply: Reply) => void;
    interact: (type: InteractionType, commentId?: number) => void;
    bookmarkDiscourse: () => void;
    collectNodeSeek: () => void;
    favoriteYaohuo: () => void;
    votePoll: (poll: TopicPoll, optionIds: string[]) => void;
  };
  navigation: {
    openTopic: (topic: Topic) => void;
    openUser: (user: UserReference) => void;
  };
};

export type TopicScreenPresentation = {
  content: TopicContentPresentation;
  chrome: {
    favorite: boolean;
    identityBlocked: boolean;
    identityChecking: boolean;
    getDiscourseEmojiUrls: (options: {
      signal?: AbortSignal;
      source: DiscourseSource;
    }) => Promise<DiscourseEmojiUrlMap>;
    back: () => void;
    openOriginal: (url: string) => void;
    openReadingSettings: () => void;
    refreshReplies: () => void;
    refreshTopic: () => void;
    share: () => void;
    toggleFavorite: () => void;
    verifyLinuxDo: () => void;
    verifyNodeSeek: () => void;
  };
  composer: {
    content: string;
    editTarget: ReplyEditTarget | null;
    face: string;
    open: boolean;
    target: ReplyTarget | null;
    changeContent: (value: string) => void;
    changeFace: (value: string) => void;
    submit: () => void;
    toggle: (open: boolean) => void;
    uploadImage: () => void;
  };
};

type TopicActions = {
  actionBusy: boolean;
  bookmarkOnDiscourseSite: () => void;
  collectOnNodeSeekSite: () => void;
  decisionFor: TopicActionDecisionFor;
  deleteReply: (reply: Reply) => void;
  editReply: (reply: Reply) => void;
  favoriteOnYaohuoSite: () => void;
  interact: (type: InteractionType, commentId?: number) => void;
  optimisticTopicActions: Record<string, OptimisticActionState>;
  submitReply: () => void;
  uploadReplyImage: () => void;
  votePoll: (poll: TopicPoll, optionIds: string[]) => void;
};

type TopicRead = ReturnType<typeof useTopicController>;

type TopicHtml = TopicContentPresentation['rendering'];

export function useTopicPresentation({
  actions,
  articleState,
  chrome,
  currentNodeSeekUser,
  html,
  nodeSeekUserId,
  read,
  session,
  topicScrollRef
}: {
  actions: TopicActions;
  articleState: Pick<TopicContentPresentation['article'], 'busy' | 'error' | 'topic' | 'yaohuoBookmarked'>;
  chrome: TopicScreenPresentation['chrome'] &
    TopicContentPresentation['navigation'] & {
      onScroll: TopicContentPresentation['replies']['onScroll'];
    };
  currentNodeSeekUser: SiteSessionViewModels['nodeseek']['currentUser'];
  html: TopicHtml;
  nodeSeekUserId: number | null;
  read: TopicRead;
  session: TopicSessionController;
  topicScrollRef: RefObject<FlashListRef<TopicListItem> | null>;
}): TopicScreenPresentation {
  const { state, commands } = session;
  const filteredReplies = useMemo(
    () =>
      filterTopicSessionReplies({
        commentQuery: state.debouncedCommentQuery,
        inlineSizedImageUrls: html.inlineSizedImageUrls,
        replyFilter: state.replyFilter,
        topicDetail: articleState.topic,
        topicImageDeriver: html.topicImageDeriver,
        topicReplies: read.topicReplies
      }),
    [
      html.inlineSizedImageUrls,
      html.topicImageDeriver,
      articleState.topic,
      read.topicReplies,
      state.debouncedCommentQuery,
      state.replyFilter
    ]
  );
  const displayReplies = useMemo(
    () => markCurrentNodeSeekOwnRepliesUnlikable(filteredReplies, currentNodeSeekUser, nodeSeekUserId),
    [currentNodeSeekUser, filteredReplies, nodeSeekUserId]
  );

  return {
    content: {
      article: {
        selectedTopic: state.selectedTopic,
        topic: articleState.topic,
        busy: articleState.busy,
        error: articleState.error,
        ...(articleState.yaohuoBookmarked === undefined ? {} : { yaohuoBookmarked: articleState.yaohuoBookmarked })
      },
      rendering: html,
      replies: {
        commentQuery: state.commentQuery,
        expandedQuotes: state.expandedQuotes,
        filtered: displayReplies,
        hasMore: read.replyHasMore,
        loadingMore: read.loadingMoreReplies,
        loadingQuotedFloors: read.loadingQuotedFloors,
        loadedQuotedReplies: read.loadedQuotedReplies,
        query: state.debouncedCommentQuery,
        quoteStateVersion: state.quoteStateVersion,
        replyComposerOpen: state.replyComposerOpen,
        replyFilter: state.replyFilter,
        source: read.topicReplies,
        topicScrollRef,
        unreadCount: read.unreadReplyCount,
        changeCommentQuery: commands.view.changeCommentQuery,
        changeFilter: commands.view.changeReplyFilter,
        loadMore: read.loadMoreReplies,
        onScroll: chrome.onScroll,
        openComposer: commands.composer.toggle,
        replyToFloor: commands.composer.replyToFloor,
        toggleReplyQuote: read.toggleReplyQuote,
        toggleTopicBodyQuote: read.toggleTopicBodyQuote
      },
      actions: {
        busy: actions.actionBusy,
        decisionFor: actions.decisionFor,
        optimistic: actions.optimisticTopicActions,
        deleteReply: actions.deleteReply,
        editReply: actions.editReply,
        interact: actions.interact,
        bookmarkDiscourse: actions.bookmarkOnDiscourseSite,
        collectNodeSeek: actions.collectOnNodeSeekSite,
        favoriteYaohuo: actions.favoriteOnYaohuoSite,
        votePoll: actions.votePoll
      },
      navigation: {
        openTopic: chrome.openTopic,
        openUser: chrome.openUser
      }
    },
    chrome,
    composer: {
      content: state.replyContent,
      editTarget: state.replyEditTarget,
      face: state.replyFace,
      open: state.replyComposerOpen,
      target: state.replyTarget,
      changeContent: commands.composer.changeContent,
      changeFace: commands.composer.changeFace,
      submit: actions.submitReply,
      toggle: commands.composer.toggle,
      uploadImage: actions.uploadReplyImage
    }
  };
}
