import { memo, useMemo } from 'react';
import { RenderHTMLSource } from 'react-native-render-html';
import { flowInlineImagesInMixedParagraphs } from '../../htmlImages';
import { HTML_REPLY_CONTENT_CLASS, TRIM_TRAILING_BLOCK_SPACING_ATTRIBUTE } from '../../htmlRenderingStyles';
import { markNodeSeekReplyReferenceLinks, normalizeRenderableHtml } from '../../topicContentHtml';
import { inlineSizedImageSignatureForHtml, type InlineSizedImageUrlMap, type TopicImageDeriver } from '../../topicDerivedData';
import { OriginalImageUpgradeBoundary } from '../../originalImageLoading';

export function TopicContentBlock({
  baseUrl,
  compact = false,
  contentWidth,
  html,
  inlineSizedImageUrls,
  originalImageUpgradeEnabled = true,
  trimTrailingBlockSpacing = false,
  topicImageDeriver
}: {
  baseUrl?: string;
  compact?: boolean;
  contentWidth: number;
  html: string | undefined;
  inlineSizedImageUrls: InlineSizedImageUrlMap;
  originalImageUpgradeEnabled?: boolean;
  trimTrailingBlockSpacing?: boolean;
  topicImageDeriver: TopicImageDeriver;
}) {
  const source = useMemo(() => {
    const replyReferenceHtml = markNodeSeekReplyReferenceLinks(normalizeRenderableHtml(html), baseUrl);
    const markedHtml = topicImageDeriver.markInlineSizedImages(replyReferenceHtml, inlineSizedImageUrls);
    const renderableHtml = flowInlineImagesInMixedParagraphs(markedHtml);
    const wrapperAttributes = [
      compact ? `class="${HTML_REPLY_CONTENT_CLASS}"` : '',
      trimTrailingBlockSpacing ? `${TRIM_TRAILING_BLOCK_SPACING_ATTRIBUTE}="true"` : ''
    ].filter(Boolean).join(' ');
    return {
      html: wrapperAttributes
        ? `<div ${wrapperAttributes}>${renderableHtml}</div>`
        : renderableHtml
    };
  }, [baseUrl, compact, html, inlineSizedImageUrls, topicImageDeriver, trimTrailingBlockSpacing]);
  return (
    <OriginalImageUpgradeBoundary enabled={originalImageUpgradeEnabled}>
      <RenderHTMLSource
        contentWidth={contentWidth}
        source={source}
      />
    </OriginalImageUpgradeBoundary>
  );
}

export const MemoizedTopicContentBlock = memo(TopicContentBlock, (previous, next) => (
  previous.baseUrl === next.baseUrl
  && previous.compact === next.compact
  && previous.contentWidth === next.contentWidth
  && previous.html === next.html
  && previous.originalImageUpgradeEnabled === next.originalImageUpgradeEnabled
  && previous.trimTrailingBlockSpacing === next.trimTrailingBlockSpacing
  && previous.topicImageDeriver === next.topicImageDeriver
  && inlineSizedImageSignatureForHtml(previous.html || '<p></p>', previous.inlineSizedImageUrls) === inlineSizedImageSignatureForHtml(next.html || '<p></p>', next.inlineSizedImageUrls)
));
