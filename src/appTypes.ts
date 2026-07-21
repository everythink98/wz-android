import type { ComponentProps } from 'react';
import type RenderHTML from 'react-native-render-html';
import type { DiagnosticTrace } from './diagnostics';
import type { Reply, Topic } from './types';

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
  diagnosticTrace?: DiagnosticTrace;
  silent?: boolean;
  afterSubmit?: boolean;
  editedReplyContent?: Pick<ReplyEditTarget, 'commentId' | 'contentMarkdown'>;
  targetReply?: ReplyRefreshTarget | null;
  excludeReply?: ReplyRefreshTarget | null;
}

export type TopicSnapshot = {
  key?: string;
  selectedTopic: Topic | null;
  commentQuery: string;
  replyFilter: ReplyFilter;
  replyContent: string;
  replyFace?: string;
  replyComposerOpen: boolean;
  replyTarget: ReplyTarget | null;
  replyEditTarget: ReplyEditTarget | null;
  expandedQuotes: Record<string, boolean>;
  scrollY?: number;
};
