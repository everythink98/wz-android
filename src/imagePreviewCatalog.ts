import { createImagePreviewCatalog, imagePreviewListFromCatalog } from './htmlImages';
import type { TopicImageDeriver } from './topicDerivedData';

export function createLazyImagePreviewResolver({
  htmlParts,
  inlineSizedImageUrls,
  topicImageDeriver
}: {
  htmlParts: string[];
  inlineSizedImageUrls: Record<string, true>;
  topicImageDeriver: TopicImageDeriver;
}) {
  let catalog: ReturnType<typeof createImagePreviewCatalog> | null = null;
  return (tappedUrl: string) => {
    if (!catalog) {
      catalog = createImagePreviewCatalog(
        htmlParts.map((html) => topicImageDeriver.markInlineSizedImages(html, inlineSizedImageUrls))
      );
    }
    return imagePreviewListFromCatalog(catalog, tappedUrl);
  };
}
