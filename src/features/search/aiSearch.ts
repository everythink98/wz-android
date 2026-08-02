import type { Topic } from '@/domain/forum/models';

export type LinuxDoAiSearchStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'unavailable' | 'error';

export type LinuxDoAiSearchState = {
  status: LinuxDoAiSearchStatus;
  enabled: boolean;
  count: number;
  message?: string;
};

export function mergeLinuxDoAiTopics(standardTopics: Topic[], aiTopics: Topic[], enabled: boolean) {
  if (!enabled || !aiTopics.length) {
    return standardTopics;
  }
  const seen = new Set(standardTopics.map((topic) => `${topic.source}:${topic.id}`));
  return [
    ...standardTopics,
    ...aiTopics.filter((topic) => {
      const key = `${topic.source}:${topic.id}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
  ];
}

export function linuxDoAiFailureState(error: unknown): LinuxDoAiSearchState {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const status = Number(record.status ?? record.statusCode) || 0;
  if (status === 403 || status === 404) {
    return { status: 'unavailable', enabled: false, count: 0, message: '当前不可用' };
  }
  return { status: 'error', enabled: false, count: 0, message: 'AI 搜索失败，可重试' };
}
