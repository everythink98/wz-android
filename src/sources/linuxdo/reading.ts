import type { DiscourseTopicReading } from '@/domain/forum/models';
import { discourseReadingFromJson } from '@/domain/forum/discourseReading';
import { isRecord } from '@/domain/forum/html';
import type { ReadingBatch } from '@/platform/query/discourseReadingRuntime';
import { withFetchGuard, type Fetcher, RequestCanceledError } from '@/platform/network/request';
import { withDiagnosticFetcher } from '@/platform/diagnostics/diagnostics';
import type { DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import { getLinuxDoCsrfToken, runLinuxDoAction } from './actionClient';
import { fetchLinuxDoJson, type LinuxDoOptions } from './reader';

export async function getLinuxDoTopicReading(id: string, options: LinuxDoOptions) {
  if (!/^\d+$/.test(id)) throw new Error('linux.do 主题 ID 不正确');
  const data = await fetchLinuxDoJson<Record<string, unknown>>(
    `/t/${id}.json`,
    options.trackVisit ? { track_visit: 'true', forceLoad: 'true' } : undefined,
    { ...options, trackView: options.trackVisit, browserFetchIntent: { owner: 'topic', priority: 'foreground' } }
  );
  if (String(data.id) !== id) throw new Error('linux.do 返回了其他主题');
  if (data.archetype === 'private_message') return;
  return discourseReadingFromJson(data) || { topicId: id };
}

export async function getLinuxDoReadingBatch(ids: readonly string[], options: LinuxDoOptions) {
  const unique = [...new Set(ids)].filter((id) => /^\d+$/.test(id));
  const snapshots: DiscourseTopicReading[] = [];
  for (let offset = 0; offset < unique.length; offset += 50) {
    const chunk = unique.slice(offset, offset + 50);
    const data = await fetchLinuxDoJson<Record<string, unknown>>(
      '/latest.json',
      { 'topic_ids[]': chunk, per_page: String(chunk.length) },
      { ...options, trackVisit: false, browserFetchIntent: { owner: 'feed', priority: 'background' } }
    );
    if (!isRecord(data.topic_list) || !Array.isArray(data.topic_list.topics)) {
      throw new Error('linux.do 不支持批量读取话题阅读状态');
    }
    for (const raw of data.topic_list.topics) {
      if (!isRecord(raw) || !chunk.includes(String(raw.id))) {
        throw new Error('linux.do 未按话题 ID 筛选，批量阅读状态不可用');
      }
      const snapshot = discourseReadingFromJson(raw);
      if (snapshot && chunk.includes(snapshot.topicId)) snapshots.push(snapshot);
    }
  }
  return snapshots;
}

export function createLinuxDoReadingSender({
  fetcher,
  scope,
  userAgent
}: {
  fetcher: Fetcher;
  scope: () => string | null;
  userAgent: () => string;
}) {
  let csrf: { identity: string; agent: string; token: Promise<string> } | undefined;
  return async (batch: ReadingBatch, identity: string, signal: AbortSignal, trace?: DiagnosticTrace) => {
    const agent = userAgent();
    const assertCurrent = () => {
      if (signal.aborted || scope() !== identity || userAgent() !== agent) throw new RequestCanceledError();
    };
    const guardedFetcher = withFetchGuard(fetcher, assertCurrent);
    const intent = { owner: 'write', priority: 'background' } as const;
    const token = async () => {
      assertCurrent();
      if (!csrf || csrf.identity !== identity || csrf.agent !== agent) {
        const promise = getLinuxDoCsrfToken({
          fetcher: trace ? withDiagnosticFetcher(trace, guardedFetcher) : guardedFetcher,
          signal,
          userAgent: agent,
          browserFetchIntent: intent
        });
        csrf = { identity, agent, token: promise };
        void promise.catch(() => {
          if (csrf?.token === promise) csrf = undefined;
        });
      }
      return csrf.token;
    };
    const body = new URLSearchParams({ topic_id: batch.topicId, topic_time: String(batch.topicTime) });
    for (const [floor, milliseconds] of Object.entries(batch.timings))
      body.set(`timings[${floor}]`, String(milliseconds));
    for (let attempt = 0; attempt < 2; attempt++) {
      let started = false;
      try {
        const csrfToken = await token();
        assertCurrent();
        await runLinuxDoAction({
          request: {
            method: 'POST',
            path: '/topics/timings',
            body: body.toString(),
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-SILENCE-LOGGER': 'true',
              'Discourse-Background': 'true'
            }
          },
          fetcher: (input, init) => {
            started = true;
            return guardedFetcher(input, init);
          },
          signal,
          csrfToken,
          userAgent: agent,
          browserFetchIntent: intent,
          readingDiagnostics: trace ? { trace, topicId: batch.topicId } : undefined
        });
        return;
      } catch (error) {
        const failure = error as Error & { status?: number; safeToRetry?: boolean };
        if (
          attempt === 0 &&
          (failure.status === 400 || failure.status === 403) &&
          /csrf|authenticity[ _-]?token/i.test(failure.message)
        ) {
          csrf = undefined;
          continue;
        }
        if (!started && !signal.aborted && failure.status !== 401 && failure.status !== 403) {
          Object.assign(failure, { safeToRetry: true });
        }
        throw error;
      }
    }
  };
}
