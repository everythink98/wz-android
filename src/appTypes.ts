import type { ComponentProps } from 'react';
import type RenderHTML from 'react-native-render-html';

export type Screen = 'feed' | 'search' | 'library' | 'more' | 'topic' | 'user';
export type ReplyFilter = 'all' | 'author' | 'images' | 'newest';
export type HealthDetail = {
  label: string;
  ok: boolean;
  message: string;
};
export type LoginNavigationRequest = { url: string };
export type HtmlBaseStyle = NonNullable<ComponentProps<typeof RenderHTML>['baseStyle']>;
export type HtmlAllowedStyles = NonNullable<ComponentProps<typeof RenderHTML>['allowedStyles']>;
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

export type YaohuoReplyTarget = ReplyTarget;
