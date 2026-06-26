import { memo, useMemo } from 'react';
import { RenderHTMLSource } from 'react-native-render-html';
import { flowInlineImagesInMixedParagraphs } from '../../htmlImages';
import { markNodeSeekReplyReferenceLinks, normalizeRenderableHtml } from '../../topicContentHtml';
import { inlineSizedImageSignatureForHtml, type InlineSizedImageUrlMap, type TopicImageDeriver } from '../../topicDerivedData';

export function TopicContentBlock({
  baseUrl,
  contentWidth,
  html,
  inlineSizedImageUrls,
  topicImageDeriver
}: {
  baseUrl?: string;
  contentWidth: number;
  html: string | undefined;
  inlineSizedImageUrls: InlineSizedImageUrlMap;
  topicImageDeriver: TopicImageDeriver;
}) {
  const source = useMemo(() => {
    const replyReferenceHtml = markNodeSeekReplyReferenceLinks(normalizeRenderableHtml(html), baseUrl);
    const markedHtml = topicImageDeriver.markInlineSizedImages(replyReferenceHtml, inlineSizedImageUrls);
    return { html: flowInlineImagesInMixedParagraphs(markedHtml) };
  }, [baseUrl, html, inlineSizedImageUrls, topicImageDeriver]);
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
  && previous.topicImageDeriver === next.topicImageDeriver
  && inlineSizedImageSignatureForHtml(previous.html || '<p></p>', previous.inlineSizedImageUrls) === inlineSizedImageSignatureForHtml(next.html || '<p></p>', next.inlineSizedImageUrls)
));
