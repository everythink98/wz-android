import type { SourceErrorInfo } from '@/domain/forum/models';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import type { ForumNotification, NotificationDetail, NotificationPage } from '@/domain/notifications/models';
import { beginDiagnosticTrace, finishDiagnosticTrace, withDiagnosticFetcher } from '@/platform/diagnostics/diagnostics';
import {
  normalizeDiagnosticReason,
  type DiagnosticFields,
  type DiagnosticTrace
} from '@/platform/diagnostics/diagnosticPolicy';
import type { NotificationAdapter, NotificationAdapterAccess } from './notificationAdapter';
import { sourceErrorFromUnknown } from './sourceErrors';
import { notificationAdapters } from './notificationAdapters';
import type { NormalizedReplyImageAsset } from './imageUpload';
import { replyImageMarkupForSource } from './imageUpload';
import { uploadNodeSeekReplyImage } from '@/sources/nodeimage/upload';
import { buildDiscourseSourceActionRequest, discourseSourceUploadUrl } from './discourseActions';
import { runLinuxDoAction } from '@/sources/linuxdo/actionClient';
import { rejectUnauthorizedResponse, withFetchGuard } from '@/platform/network/request';

export type NotificationAccessReader = (
  source: NotificationSource
) => NotificationAdapterAccess | Promise<NotificationAdapterAccess>;
export type NotificationSourceAllowed = (source: NotificationSource) => boolean | Promise<boolean>;
export type NotificationPrivateAccessAllowed = (
  source: NotificationSource,
  identityKey: string
) => boolean | Promise<boolean>;

interface NotificationBatchResult {
  items: ForumNotification[];
  errors: Partial<Record<NotificationSource, SourceErrorInfo>>;
}

interface NotificationBatchPage extends NotificationBatchResult {
  nextCursors: Partial<Record<NotificationSource, string | null>>;
  hasMore: boolean;
}

function assertConfirmedAccess(source: NotificationSource, access: NotificationAdapterAccess) {
  if (!access.userId || access.identityKey !== `${source}:${access.userId}`) {
    const error = new Error('账号身份尚未确认');
    Object.assign(error, { source, loginRequired: true });
    throw error;
  }
  return access;
}

function assertNotAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error('操作已取消');
  error.name = 'AbortError';
  throw error;
}

async function runWithNotificationDiagnostics<T>(
  source: NotificationSource,
  operation: 'load' | 'refresh' | 'open' | 'mutate',
  run: (trace: DiagnosticTrace) => Promise<T>,
  summarize: (result: T) => DiagnosticFields = () => ({})
) {
  const trace = beginDiagnosticTrace('source', operation, { source });
  try {
    const result = await run(trace);
    finishDiagnosticTrace(trace, 'success', { source, ...summarize(result) });
    return result;
  } catch (error) {
    const sourceError = sourceErrorFromUnknown(source, error);
    const blocked = ['login-expired', 'login-required', 'permission-denied', 'verification-required'].includes(
      sourceError.kind
    );
    const reason = blocked
      ? sourceError.kind === 'login-expired'
        ? 'login_required'
        : sourceError.kind.replace(/-/g, '_')
      : normalizeDiagnosticReason(error);
    finishDiagnosticTrace(trace, reason === 'canceled' ? 'canceled' : blocked ? 'blocked' : 'failure', {
      source,
      reason
    });
    throw error;
  }
}

export function createNotificationGateway({
  adapters = notificationAdapters,
  onSessionExpired,
  privateAccessAllowed,
  readAccess,
  requestSessionEpoch,
  sourceAllowed
}: {
  adapters?: Record<NotificationSource, NotificationAdapter>;
  onSessionExpired?: (source: NotificationSource, requestSessionEpoch: number) => void;
  privateAccessAllowed: NotificationPrivateAccessAllowed;
  readAccess: NotificationAccessReader;
  requestSessionEpoch?: (source: NotificationSource) => number;
  sourceAllowed: NotificationSourceAllowed;
}) {
  const assertSourceAllowed = async (source: NotificationSource) => {
    if (await sourceAllowed(source)) return;
    throw Object.assign(new Error('内容源已停用'), { reason: 'source-disabled', source });
  };
  const assertPrivateAccessCurrent = async (source: NotificationSource, identityKey: string, signal?: AbortSignal) => {
    assertNotAborted(signal);
    await assertSourceAllowed(source);
    if (!(await privateAccessAllowed(source, identityKey))) {
      throw Object.assign(new Error('账号状态已变化'), {
        loginRequired: true,
        reason: 'private-access-stale',
        source
      });
    }
    await assertSourceAllowed(source);
    assertNotAborted(signal);
  };
  const accessFor = async (
    source: NotificationSource,
    trace: DiagnosticTrace,
    signal?: AbortSignal,
    expectedIdentityKey?: string
  ) => {
    assertNotAborted(signal);
    await assertSourceAllowed(source);
    if (expectedIdentityKey) await assertPrivateAccessCurrent(source, expectedIdentityKey, signal);
    const access = assertConfirmedAccess(source, await readAccess(source));
    if (expectedIdentityKey && access.identityKey !== expectedIdentityKey) {
      throw Object.assign(new Error('账号状态已变化'), {
        loginRequired: true,
        reason: 'private-access-stale',
        source
      });
    }
    await assertPrivateAccessCurrent(source, access.identityKey, signal);
    const assertCurrent = async () => {
      await assertPrivateAccessCurrent(source, access.identityKey, signal);
    };
    return {
      ...access,
      fetcher: withFetchGuard(
        withDiagnosticFetcher(trace, rejectUnauthorizedResponse(access.fetcher || fetch)),
        assertCurrent
      ),
      ...(signal ? { signal } : {})
    };
  };
  const runWithAccess = async <T>(
    source: NotificationSource,
    trace: DiagnosticTrace,
    signal: AbortSignal | undefined,
    expectedIdentityKey: string | undefined,
    run: (access: NotificationAdapterAccess) => Promise<T>
  ) => {
    const access = await accessFor(source, trace, signal, expectedIdentityKey);
    const requestEpoch = requestSessionEpoch?.(source) ?? 0;
    let result: T;
    try {
      result = await run(access);
    } catch (error) {
      if (error && typeof error === 'object' && (error as { reason?: unknown }).reason === 'http-401') {
        onSessionExpired?.(source, requestEpoch);
      }
      throw error;
    }
    await assertPrivateAccessCurrent(source, access.identityKey, signal);
    return result;
  };

  const listPage = async (
    source: NotificationSource,
    options: {
      cursor?: string | null;
      categoryId?: string;
      expectedIdentityKey?: string;
      limit?: number;
      signal?: AbortSignal;
      unreadOnly?: boolean;
    } = {}
  ) =>
    runWithNotificationDiagnostics(
      source,
      'load',
      async (trace) =>
        runWithAccess(source, trace, options.signal, options.expectedIdentityKey, async (access) =>
          adapters[source].listPage({
            ...access,
            categoryId: options.categoryId,
            cursor: options.cursor,
            limit: options.limit,
            unreadOnly: options.unreadOnly
          })
        ),
      (page) => ({ itemCount: page.items.length })
    );

  return {
    listPage,

    async getCategories(source: NotificationSource, expectedIdentityKey?: string, signal?: AbortSignal) {
      return runWithNotificationDiagnostics(source, 'load', async (trace) =>
        runWithAccess(source, trace, signal, expectedIdentityKey, async (access) =>
          adapters[source].getCategories(access)
        )
      );
    },

    async listAllPage(options: {
      cursors?: Partial<Record<NotificationSource, string | null>>;
      limit?: number;
      signal?: AbortSignal;
      sources: readonly NotificationSource[];
      unreadOnly?: boolean;
    }): Promise<NotificationBatchPage> {
      const sources = options.sources.filter((source) => options.cursors?.[source] !== null);
      const settled = await Promise.allSettled(
        sources.map((source) =>
          listPage(source, {
            cursor: options.cursors?.[source],
            limit: options.limit,
            signal: options.signal,
            unreadOnly: options.unreadOnly
          })
        )
      );
      const pages: Partial<Record<NotificationSource, NotificationPage>> = {};
      const errors: NotificationBatchResult['errors'] = {};
      const nextCursors: NotificationBatchPage['nextCursors'] = {};
      settled.forEach((result, index) => {
        const source = sources[index]!;
        if (result.status === 'fulfilled') {
          pages[source] = result.value;
          nextCursors[source] = result.value.hasMore ? result.value.cursor : null;
        } else {
          errors[source] = sourceErrorFromUnknown(source, result.reason);
          nextCursors[source] = null;
        }
      });
      return {
        items: sources.flatMap((source) => pages[source]?.items || []),
        errors,
        nextCursors,
        hasMore: Object.values(nextCursors).some((cursor) => cursor !== null)
      };
    },

    async readUnreadSnapshot(source: NotificationSource, signal?: AbortSignal) {
      return runWithNotificationDiagnostics(
        source,
        'refresh',
        async (trace) =>
          runWithAccess(source, trace, signal, undefined, async (access) =>
            adapters[source].readUnreadSnapshot(access)
          ),
        (snapshot) => ({ count: snapshot.total })
      );
    },

    async loadDetail(
      item: ForumNotification,
      expectedIdentityKey: string,
      signal?: AbortSignal
    ): Promise<NotificationDetail> {
      return runWithNotificationDiagnostics(item.source, 'open', async (trace) =>
        runWithAccess(item.source, trace, signal, expectedIdentityKey, async (access) =>
          adapters[item.source].loadDetail(item, access)
        )
      );
    },

    async markRead(
      item: ForumNotification,
      detail: NotificationDetail,
      expectedIdentityKey: string,
      signal?: AbortSignal
    ) {
      return runWithNotificationDiagnostics(
        item.source,
        'mutate',
        async (trace) =>
          runWithAccess(item.source, trace, signal, expectedIdentityKey, async (access) =>
            adapters[item.source].markRead(item, detail, access)
          ),
        (result) => ({ isConfirmed: result.confirmed })
      );
    },

    async replyToConversation(
      item: ForumNotification,
      content: string,
      expectedIdentityKey: string,
      signal?: AbortSignal
    ) {
      return runWithNotificationDiagnostics(
        item.source,
        'mutate',
        async (trace) =>
          runWithAccess(item.source, trace, signal, expectedIdentityKey, async (access) => {
            if (!content.trim()) throw new Error('请输入回复内容');
            assertNotAborted(signal);
            return adapters[item.source].replyToConversation(item, content, access);
          }),
        (result) => ({ isConfirmed: result.confirmed })
      );
    },

    async uploadReplyImage(
      source: NotificationSource,
      options: {
        expectedIdentityKey: string;
        file: NormalizedReplyImageAsset;
        nodeImageApiKey?: string;
        signal?: AbortSignal;
      }
    ) {
      return runWithNotificationDiagnostics(source, 'mutate', async (trace) =>
        runWithAccess(source, trace, options.signal, options.expectedIdentityKey, async (access) => {
          if (source === 'yaohuo') throw new Error('妖火私信仅支持纯文本');
          assertNotAborted(options.signal);
          let imageUrl = '';
          if (source === 'nodeseek') {
            imageUrl = await uploadNodeSeekReplyImage({
              apiKey: options.nodeImageApiKey || '',
              file: options.file,
              fetcher: access.fetcher,
              signal: options.signal,
              timeoutMs: access.timeoutMs
            });
          } else {
            const request = buildDiscourseSourceActionRequest(source, { type: 'upload', file: options.file });
            const data = await runLinuxDoAction({
              fetcher: access.fetcher,
              request,
              signal: options.signal,
              timeoutMs: access.timeoutMs,
              userAgent: access.userAgent
            });
            imageUrl = discourseSourceUploadUrl(source, data);
          }
          assertNotAborted(options.signal);
          return { markup: replyImageMarkupForSource(source, imageUrl, options.file.name) };
        })
      );
    },

    async markAllRead(source: NotificationSource, expectedIdentityKey: string, signal?: AbortSignal) {
      return runWithNotificationDiagnostics(
        source,
        'mutate',
        async (trace) =>
          runWithAccess(source, trace, signal, expectedIdentityKey, async (access) => {
            const markAllRead = adapters[source].markAllRead;
            return markAllRead ? markAllRead(access) : { confirmed: false, message: '该站点需要逐条打开消息' };
          }),
        (result) => ({ isConfirmed: result.confirmed })
      );
    }
  };
}
