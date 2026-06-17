import { memo, useMemo } from 'react';
import { RenderHTMLSource } from 'react-native-render-html';
import { flowInlineImagesInMixedParagraphs } from '../../htmlImages';
import { inlineSizedImageSignatureForHtml, type InlineSizedImageUrlMap, type TopicImageDeriver } from '../../topicDerivedData';

export function TopicContentBlock({
  contentWidth,
  html,
  inlineSizedImageUrls,
  topicImageDeriver
}: {
  contentWidth: number;
  html: string | undefined;
  inlineSizedImageUrls: InlineSizedImageUrlMap;
  topicImageDeriver: TopicImageDeriver;
}) {
  const source = useMemo(() => {
    const markedHtml = topicImageDeriver.markInlineSizedImages(html || '<p></p>', inlineSizedImageUrls);
    return { html: flowInlineImagesInMixedParagraphs(markedHtml) };
  }, [html, inlineSizedImageUrls, topicImageDeriver]);
  return (
    <RenderHTMLSource
      contentWidth={contentWidth}
      source={source}
    />
  );
}

export const MemoizedTopicContentBlock = memo(TopicContentBlock, (previous, next) => (
  previous.contentWidth === next.contentWidth
  && previous.html === next.html
  && previous.topicImageDeriver === next.topicImageDeriver
  && inlineSizedImageSignatureForHtml(previous.html || '<p></p>', previous.inlineSizedImageUrls) === inlineSizedImageSignatureForHtml(next.html || '<p></p>', next.inlineSizedImageUrls)
));
