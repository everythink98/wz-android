import { memo, useMemo } from 'react';
import { RenderHTMLSource } from 'react-native-render-html';
import { flowInlineImagesInMixedParagraphs } from '../../htmlImages';
import { markNodeSeekReplyReferenceLinks, normalizeRenderableHtml } from '../../topicContentHtml';
import { inlineSizedImageSignatureForHtml, type InlineSizedImageUrlMap, type TopicImageDeriver } from '../../topicDerivedData';

export const TRIM_TRAILING_BLOCK_SPACING_ATTRIBUTE = 'data-trim-trailing-block-spacing';

export function TopicContentBlock({
  baseUrl,
  contentWidth,
  html,
  inlineSizedImageUrls,
  trimTrailingBlockSpacing = false,
  topicImageDeriver
}: {
  baseUrl?: string;
  contentWidth: number;
  html: string | undefined;
  inlineSizedImageUrls: InlineSizedImageUrlMap;
  trimTrailingBlockSpacing?: boolean;
  topicImageDeriver: TopicImageDeriver;
}) {
  const source = useMemo(() => {
    const replyReferenceHtml = markNodeSeekReplyReferenceLinks(normalizeRenderableHtml(html), baseUrl);
    const markedHtml = topicImageDeriver.markInlineSizedImages(replyReferenceHtml, inlineSizedImageUrls);
    const renderableHtml = flowInlineImagesInMixedParagraphs(markedHtml);
    return {
      html: trimTrailingBlockSpacing
        ? `<div ${TRIM_TRAILING_BLOCK_SPACING_ATTRIBUTE}="true">${renderableHtml}</div>`
        : renderableHtml
    };
  }, [baseUrl, html, inlineSizedImageUrls, topicImageDeriver, trimTrailingBlockSpacing]);
  return (
    <RenderHTMLSource
      contentWidth={contentWidth}
      source={source}
    />
  );
}

export const MemoizedTopicContentBlock = memo(TopicContentBlock, (previous, next) => (
  previous.baseUrl === next.baseUrl
  && previous.contentWidth === next.contentWidth
  && previous.html === next.html
  && previous.trimTrailingBlockSpacing === next.trimTrailingBlockSpacing
  && previous.topicImageDeriver === next.topicImageDeriver
  && inlineSizedImageSignatureForHtml(previous.html || '<p></p>', previous.inlineSizedImageUrls) === inlineSizedImageSignatureForHtml(next.html || '<p></p>', next.inlineSizedImageUrls)
));
