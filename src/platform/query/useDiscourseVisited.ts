import { useQuery } from '@tanstack/react-query';
import { EMPTY_DISCOURSE_READING_STATE, selectDiscourseVisited } from '@/domain/forum/discourseReading';
import { discourseReadingQueryKey } from './discourseReadingRuntime';

/** Subscribe to card membership only; viewport changes must not redraw every list. */
export function useDiscourseVisited(scope: string | null | undefined) {
  const { data = EMPTY_DISCOURSE_READING_STATE } = useQuery({
    queryKey: discourseReadingQueryKey(scope || null),
    enabled: false,
    gcTime: Infinity,
    select: selectDiscourseVisited,
    queryFn: async () => EMPTY_DISCOURSE_READING_STATE
  });
  return data;
}
