import { memo, useMemo } from 'react';
import { RenderHTMLSource } from 'react-native-render-html';
import { flowInlineImagesInMixedParagraphs, markInlineSizedImageHtml } from '../../htmlImages';

export function TopicContentBlock({
  contentWidth,
  html,
  inlineSizedImageUrls
}: {
  contentWidth: number;
  html: string | undefined;
  inlineSizedImageUrls: Record<string, true>;
}) {
  const source = useMemo(() => {
    const markedHtml = Object.keys(inlineSizedImageUrls).reduce((current, url) => markInlineSizedImageHtml(current, url), html || '<p></p>');
    return { html: flowInlineImagesInMixedParagraphs(markedHtml) };
  }, [html, inlineSizedImageUrls]);
  return (
    <RenderHTMLSource
      contentWidth={contentWidth}
      source={source}
    />
  );
}

export const MemoizedTopicContentBlock = memo(TopicContentBlock);
