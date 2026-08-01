import type { ComponentProps } from 'react';
import type RenderHTML from 'react-native-render-html';

export type HtmlBaseStyle = NonNullable<ComponentProps<typeof RenderHTML>['baseStyle']>;
export type HtmlAllowedStyles = NonNullable<ComponentProps<typeof RenderHTML>['allowedStyles']>;
export type HtmlClassesStyles = NonNullable<ComponentProps<typeof RenderHTML>['classesStyles']>;
export type HtmlIgnoredStyles = NonNullable<ComponentProps<typeof RenderHTML>['ignoredStyles']>;
export type HtmlRenderers = NonNullable<ComponentProps<typeof RenderHTML>['renderers']>;
export type HtmlRenderersProps = NonNullable<ComponentProps<typeof RenderHTML>['renderersProps']>;
export type HtmlTagsStyles = NonNullable<ComponentProps<typeof RenderHTML>['tagsStyles']>;
