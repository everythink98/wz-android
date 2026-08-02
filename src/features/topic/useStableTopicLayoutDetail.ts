import { useLayoutEffect, useRef } from 'react';
import type { TopicDetail } from '@/domain/forum/models';
import { hasSameYaohuoTopicLayout } from './model/topicContentIdentity';

export function useStableTopicLayoutDetail(topicDetail: TopicDetail | null) {
  const stableDetailRef = useRef(topicDetail);
  const stableDetail = hasSameYaohuoTopicLayout(stableDetailRef.current, topicDetail)
    ? stableDetailRef.current
    : topicDetail;
  useLayoutEffect(() => {
    stableDetailRef.current = stableDetail;
  }, [stableDetail]);
  return stableDetail;
}
