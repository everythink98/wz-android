import type { ComponentProps } from 'react';
import type RenderHTML from 'react-native-render-html';

export type HtmlRenderers = NonNullable<ComponentProps<typeof RenderHTML>['renderers']>;
export type HtmlRenderersProps = NonNullable<ComponentProps<typeof RenderHTML>['renderersProps']>;
