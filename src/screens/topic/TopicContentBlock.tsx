import { memo, useMemo } from 'react';
import { RenderHTMLSource } from 'react-native-render-html';
import { flowInlineImagesInMixedParagraphs } from '../../htmlImages';
import type { InlineSizedImageUrlMap, TopicImageDeriver } from '../../topicDerivedData';

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

export const MemoizedTopicContentBlock = memo(TopicContentBlock);
