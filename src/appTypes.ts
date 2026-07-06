import type { ComponentProps } from 'react';
import type RenderHTML from 'react-native-render-html';
import type { Reply, Topic, TopicDetail } from './types';

export type Screen = 'feed' | 'search' | 'library' | 'more' | 'topic' | 'user';
export type ReplyFilter = 'all' | 'author' | 'images' | 'newest';
export type LoginNavigationRequest = { url: string };
export type HtmlBaseStyle = NonNullable<ComponentProps<typeof RenderHTML>['baseStyle']>;
export type HtmlAllowedStyles = NonNullable<ComponentProps<typeof RenderHTML>['allowedStyles']>;
export type HtmlClassesStyles = NonNullable<ComponentProps<typeof RenderHTML>['classesStyles']>;
export type HtmlIgnoredStyles = NonNullable<ComponentProps<typeof RenderHTML>['ignoredStyles']>;
export type HtmlRenderers = NonNullable<ComponentProps<typeof RenderHTML>['renderers']>;
export type HtmlRenderersProps = NonNullable<ComponentProps<typeof RenderHTML>['renderersProps']>;
export type HtmlTagsStyles = NonNullable<ComponentProps<typeof RenderHTML>['tagsStyles']>;
export interface ReplyTarget {
  floor: number;
  author?: string;
  authorId?: string;
  commentId?: number;
}

export interface ReplyEditTarget {
  commentId: number;
  floor?: number;
  contentMarkdown: string;
}

export type ReplyRefreshTarget = Pick<Reply, 'commentId' | 'floor' | 'deletePath'>;

export interface TopicRepliesRefreshOptions {
  silent?: boolean;
  afterSubmit?: boolean;
  nocache?: boolean;
  editedReplyContent?: Pick<ReplyEditTarget, 'commentId' | 'contentMarkdown'>;
  targetReply?: ReplyRefreshTarget | null;
  excludeReply?: ReplyRefreshTarget | null;
}

export type TopicSnapshot = {
  key?: string;
  selectedTopic: Topic | null;
  topicDetail: TopicDetail | null;
  topicReplies: Reply[];
  topicError: string;
  replyHasMore: boolean;
  replyNextPage: number | null;
  replyNextOffset: number | null;
  unreadReplyCount: number;
  commentQuery: string;
  replyFilter: ReplyFilter;
  replyContent: string;
  replyFace?: string;
  replyComposerOpen: boolean;
  replyTarget: ReplyTarget | null;
  replyEditTarget: ReplyEditTarget | null;
  expandedQuotes: Record<string, boolean>;
  loadedQuotedReplies: Record<number, Reply>;
  loadingQuotedFloors: Record<string, boolean>;
  scrollY?: number;
};
