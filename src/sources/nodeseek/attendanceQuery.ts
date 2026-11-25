import { queryOptions } from '@tanstack/react-query';
import { forumQueryKeys } from '@/platform/query/serverState';
import type { ReadGateway } from '@/sources/readGateway';

export function nodeSeekAttendanceKey(userId: string, sessionEpoch: number, readPlanScope: string) {
  return forumQueryKeys.accountData({ source: 'nodeseek', kind: 'attendance', userId, sessionEpoch, readPlanScope });
}

export function nodeSeekAttendanceQuery({
  gateway,
  userId,
  sessionEpoch,
  plan
}: {
  gateway: Pick<ReadGateway, 'getNodeSeekAttendanceBoard'>;
  userId: string;
  sessionEpoch: number;
  plan: ReturnType<ReadGateway['getReadPlan']>;
}) {
  return queryOptions({
    gcTime: Infinity,
    queryKey: nodeSeekAttendanceKey(userId, sessionEpoch, plan.cacheScope),
    queryFn: ({ signal }) => gateway.getNodeSeekAttendanceBoard({ userId, signal }, { plan })
  });
}
