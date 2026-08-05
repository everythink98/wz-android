import type { SourceErrorInfo } from '@/domain/forum/models';
import { notificationSources, type NotificationSource } from '@/domain/forum/sourceCatalog';
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
import { xiaoyinsiCredentialsHaveScope } from '@/sources/xiaoyinsi/credentials';
import type { NormalizedReplyImageAsset } from './imageUpload';
import { replyImageMarkupForSource } from './imageUpload';
import { uploadNodeSeekReplyImage } from '@/sources/nodeimage/upload';
import { buildDiscourseSourceActionRequest, discourseSourceUploadUrl } from './discourseActions';
import { runLinuxDoAction } from '@/sources/linuxdo/actionClient';
import { runXiaoyinsiAction } from '@/sources/xiaoyinsi/actionClient';

export type NotificationAccessReader = (
  source: NotificationSource
) => NotificationAdapterAccess | Promise<NotificationAdapterAccess>;

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
  readAccess
}: {
  adapters?: Record<NotificationSource, NotificationAdapter>;
  readAccess: NotificationAccessReader;
}) {
  const accessFor = async (
    source: NotificationSource,
    trace: DiagnosticTrace,
    signal?: AbortSignal,
    expectedIdentityKey?: string
  ) => {
    assertNotAborted(signal);
    const access = assertConfirmedAccess(source, await readAccess(source));
    assertNotAborted(signal);
    if (expectedIdentityKey && access.identityKey !== expectedIdentityKey) {
      const error = new Error('账号状态已变化');
      Object.assign(error, { source, loginRequired: true });
      throw error;
    }
    return {
      ...access,
      fetcher: withDiagnosticFetcher(trace, access.fetcher || fetch),
      ...(signal ? { signal } : {})
    };
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
        adapters[source].listPage({
          ...(await accessFor(source, trace, options.signal, options.expectedIdentityKey)),
          categoryId: options.categoryId,
          cursor: options.cursor,
          limit: options.limit,
          unreadOnly: options.unreadOnly
        }),
      (page) => ({ itemCount: page.items.length })
    );

  return {
    listPage,

    async getCategories(source: NotificationSource, expectedIdentityKey?: string, signal?: AbortSignal) {
      return runWithNotificationDiagnostics(source, 'load', async (trace) =>
        adapters[source].getCategories(await accessFor(source, trace, signal, expectedIdentityKey))
      );
    },

    async listAllPage(
      options: {
        cursors?: Partial<Record<NotificationSource, string | null>>;
        limit?: number;
        signal?: AbortSignal;
        sources?: NotificationSource[];
        unreadOnly?: boolean;
      } = {}
    ): Promise<NotificationBatchPage> {
      const sources = (options.sources || notificationSources).filter((source) => options.cursors?.[source] !== null);
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
        async (trace) => adapters[source].readUnreadSnapshot(await accessFor(source, trace, signal)),
        (snapshot) => ({ count: snapshot.total })
      );
    },

    async loadDetail(
      item: ForumNotification,
      expectedIdentityKey: string,
      signal?: AbortSignal
    ): Promise<NotificationDetail> {
      return runWithNotificationDiagnostics(item.source, 'open', async (trace) =>
        adapters[item.source].loadDetail(item, await accessFor(item.source, trace, signal, expectedIdentityKey))
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
          adapters[item.source].markRead(
            item,
            detail,
            await accessFor(item.source, trace, signal, expectedIdentityKey)
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
        async (trace) => {
          const access = await accessFor(item.source, trace, signal, expectedIdentityKey);
          if (item.source === 'xiaoyinsi' && !xiaoyinsiCredentialsHaveScope(access.xiaoyinsiCredentials, 'write')) {
            throw new Error('小隐寺需要升级写入授权');
          }
          if (!content.trim()) throw new Error('请输入回复内容');
          assertNotAborted(signal);
          return adapters[item.source].replyToConversation(item, content, access);
        },
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
      return runWithNotificationDiagnostics(source, 'mutate', async (trace) => {
        const access = await accessFor(source, trace, options.signal, options.expectedIdentityKey);
        if (source === 'yaohuo') throw new Error('妖火私信仅支持纯文本');
        if (source === 'xiaoyinsi' && !xiaoyinsiCredentialsHaveScope(access.xiaoyinsiCredentials, 'write')) {
          throw new Error('小隐寺需要升级写入授权');
        }
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
          const data =
            source === 'linuxdo'
              ? await runLinuxDoAction({
                  fetcher: access.fetcher,
                  request,
                  signal: options.signal,
                  timeoutMs: access.timeoutMs,
                  userAgent: access.userAgent
                })
              : await runXiaoyinsiAction({
                  credentials: access.xiaoyinsiCredentials!,
                  fetcher: access.fetcher,
                  request,
                  signal: options.signal,
                  timeoutMs: access.timeoutMs
                });
          imageUrl = discourseSourceUploadUrl(source, data);
        }
        assertNotAborted(options.signal);
        return { markup: replyImageMarkupForSource(source, imageUrl, options.file.name) };
      });
    },

    async markAllRead(source: NotificationSource, expectedIdentityKey: string, signal?: AbortSignal) {
      return runWithNotificationDiagnostics(
        source,
        'mutate',
        async (trace) => {
          const markAllRead = adapters[source].markAllRead;
          return markAllRead
            ? markAllRead(await accessFor(source, trace, signal, expectedIdentityKey))
            : { confirmed: false, message: '该站点需要逐条打开消息' };
        },
        (result) => ({ isConfirmed: result.confirmed })
      );
    }
  };
}
