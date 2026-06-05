import { useMemo } from 'react';
import { createTopicImageDeriver } from '../topicDerivedData';

export function useHtmlRenderingController(topicKey: string) {
  const topicImageDeriver = useMemo(
    () => createTopicImageDeriver(),
    [topicKey]
  );

  return { topicImageDeriver };
}
