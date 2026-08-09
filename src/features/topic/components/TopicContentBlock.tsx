import { memo, useMemo } from 'react';
import { RenderHTMLSource } from 'react-native-render-html';
import type { ContentContinuation } from '../rendering/htmlStyles';
import { OriginalImageUpgradeBoundary } from '@/platform/media/originalImageLoading';
import { TopicContentPresentationProvider } from '../rendering/TopicContentPresentation';

type TopicContentBlockProps = {
  contentWidth: number;
  continuation?: ContentContinuation;
  html: string | undefined;
  originalImageUpgradeEnabled?: boolean;
  trimTrailingBlockSpacing?: boolean;
};

export function TopicContentBlock({
  contentWidth,
  continuation = 'only',
  html,
  originalImageUpgradeEnabled = true,
  trimTrailingBlockSpacing = false
}: TopicContentBlockProps) {
  const source = useMemo(() => ({ html: html || '' }), [html]);
  return (
    <TopicContentPresentationProvider continuation={continuation} trimTrailing={trimTrailingBlockSpacing}>
      <OriginalImageUpgradeBoundary enabled={originalImageUpgradeEnabled}>
        <RenderHTMLSource contentWidth={contentWidth} source={source} />
      </OriginalImageUpgradeBoundary>
    </TopicContentPresentationProvider>
  );
}

export const MemoizedTopicContentBlock = memo(TopicContentBlock);
