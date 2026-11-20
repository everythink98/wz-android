import { resolveLinuxDoUpload } from '@/sources/linuxdo/uploadUrls';
import type { SourceErrorInfo } from '@/domain/forum/models';
import { nextPageCursor } from '@/domain/forum/pagination';
import type { DiscoursePostPolicy } from '@/domain/forum/discoursePolicy';
import { setLinuxDoPolicyAcceptance } from '@/sources/linuxdo/policy';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import type { RequestAccountRecheck } from '@/domain/session/sessionContracts';
import type {
  ForumNotification,
  NotificationDetail,
  NotificationMessagePage,
  NotificationPage
} from '@/domain/notifications/models';
import { notificationPageError } from '@/domain/notifications/notificationQuality';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  withDiagnosticFetcher
} from '@/platform/diagnostics/diagnostics';
import {
  annotateSourceDiagnosticSummary,
  sourceDiagnosticSummary
} from '@/platform/diagnostics/sourceDiagnosticSummary';
import {
  normalizeDiagnosticReason,
  type DiagnosticFields,
  type DiagnosticTrace
} from '@/platform/diagnostics/diagnosticPolicy';
import type { NotificationAdapter, NotificationAdapterAccess } from './notificationAdapter';
import { errorRequiresAccountRecheck, sourceErrorFromUnknown } from './sourceErrors';
import { notificationAdapters } from './notificationAdapters';
import type { NormalizedReplyImageAsset } from './imageUpload';
import { replyImageMarkupForSource } from './imageUpload';
import { uploadNodeSeekReplyImage } from '@/sources/nodeimage/upload';
import { buildDiscourseActionRequest, discourseImageUrlFromUploadResponse } from '@/sources/discourse/actionRequest';
import { runLinuxDoAction } from '@/sources/linuxdo/actionClient';
import { LINUXDO_BASE_URL } from '@/sources/linuxdo/protocol';
import { fetchLinuxDoPollCapabilities } from '@/sources/linuxdo/pollCapabilities';
import {
  fetchLinuxDoTemplates,
  recordLinuxDoTemplateUse as recordLinuxDoTemplateUsage
} from '@/sources/linuxdo/templates';
import {
  rejectUnauthorizedResponse,
  withFetchGuard,
  withRequestBeforeSend,
  type Fetcher,
  type RequestDispatchState
} from '@/platform/network/request';

export type NotificationAccessReader = (
  source: NotificationSource
) => NotificationAdapterAccess | Promise<NotificationAdapterAccess>;
type NotificationSourceAllowed = (source: NotificationSource) => boolean;
type NotificationPrivateAccessAllowed = (source: NotificationSource, identityKey: string) => boolean;

interface NotificationBatchResult {
  items: ForumNotification[];
  errors: Partial<Record<NotificationSource, SourceErrorInfo>>;
}

interface NotificationBatchPage extends NotificationBatchResult {
  qualities: Partial<Record<NotificationSource, NotificationPage['quality']>>;
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

function staleNotificationAccess(source: NotificationSource) {
  return Object.assign(new Error('账号状态已变化'), { loginRequired: true, reason: 'private-access-stale', source });
}

type NotificationOperation =
  | 'image-load'
  | 'notification-list'
  | 'notification-categories'
  | 'notification-unread'
  | 'notification-detail'
  | 'notification-history'
  | 'notification-mark-read'
  | 'notification-policy'
  | 'notification-reply'
  | 'notification-upload'
  | 'notification-mark-all-read'
  | 'notification-poll-capabilities'
  | 'notification-templates'
  | 'notification-template-use';

const blockedNotificationReasons = {
  'login-required': 'login_required',
  'login-expired': 'login_required',
  'permission-denied': 'permission_denied',
  'verification-required': 'verification_required',
  ordinary: undefined
} satisfies Record<SourceErrorInfo['kind'], DiagnosticFields['reason']>;

function finishNotificationFailure(trace: DiagnosticTrace, source: NotificationSource, error: unknown) {
  const sourceError = sourceErrorFromUnknown(source, error);
  const blockedReason = blockedNotificationReasons[sourceError.kind];
  const reason =
    sourceError.reason === 'private-access-stale' ? 'stale' : (blockedReason ?? normalizeDiagnosticReason(error));
  const outcome = reason === 'canceled' || reason === 'stale' ? reason : blockedReason ? 'blocked' : 'failure';
  finishDiagnosticTrace(trace, outcome, { source, reason });
}

export function createNotificationGateway({
  adapters = notificationAdapters,
  onSessionExpired,
  privateAccessAllowed,
  readAccess,
  requestAccountRecheck,
  requestSessionEpoch,
  sourceAllowed
}: {
  adapters?: Record<NotificationSource, NotificationAdapter>;
  onSessionExpired?: (source: NotificationSource, requestSessionEpoch: number) => void;
  privateAccessAllowed: NotificationPrivateAccessAllowed;
  readAccess: NotificationAccessReader;
  requestAccountRecheck?: RequestAccountRecheck;
  requestSessionEpoch?: (source: NotificationSource) => number;
  sourceAllowed: NotificationSourceAllowed;
}) {
  const currentEpoch = (source: NotificationSource) => requestSessionEpoch?.(source) ?? 0;
  const runWithAccess = async <T>(
    source: NotificationSource,
    operation: NotificationOperation,
    {
      signal,
      expectedIdentityKey,
      expectedSessionEpoch
    }: { signal?: AbortSignal; expectedIdentityKey?: string; expectedSessionEpoch?: number },
    run: (access: NotificationAdapterAccess & { fetcher: Fetcher }, adapter: NotificationAdapter) => Promise<T>,
    summarize: (result: T) => DiagnosticFields = () => ({}),
    parentTrace?: DiagnosticTrace
  ) => {
    const trace = beginDiagnosticTrace('source', operation, { source, parentTraceId: parentTrace?.traceId });
    const requestEpoch = expectedSessionEpoch ?? currentEpoch(source);
    let identityKey = expectedIdentityKey;
    const assertCurrent = () => {
      assertNotAborted(signal);
      if (!sourceAllowed(source)) throw Object.assign(new Error('内容源已停用'), { reason: 'source-disabled', source });
      if (currentEpoch(source) !== requestEpoch || (identityKey && !privateAccessAllowed(source, identityKey)))
        throw staleNotificationAccess(source);
    };
    try {
      assertCurrent();
      const access = assertConfirmedAccess(source, await readAccess(source));
      if (expectedIdentityKey && access.identityKey !== expectedIdentityKey) throw staleNotificationAccess(source);
      identityKey = access.identityKey;
      assertCurrent();
      const transport = access.fetcher || fetch;
      const fetcher = withFetchGuard(
        withDiagnosticFetcher(
          trace,
          withRequestBeforeSend(
            source === 'nodeseek' && operation === 'notification-upload'
              ? transport
              : rejectUnauthorizedResponse(transport),
            assertCurrent
          )
        ),
        assertCurrent
      );
      let result: T;
      try {
        result = await run({ ...access, fetcher, ...(signal ? { signal } : {}) }, adapters[source]);
      } catch (error) {
        assertCurrent();
        if ((source === 'linuxdo' || source === 'nodeseek') && errorRequiresAccountRecheck(error)) {
          requestAccountRecheck?.(source, requestEpoch, trace.traceId);
        } else if (sourceErrorFromUnknown(source, error).reason === 'http-401') {
          onSessionExpired?.(source, requestEpoch);
        }
        throw error;
      }
      assertCurrent();

      const summary = sourceDiagnosticSummary(result);
      const fields = summarize(result);
      if (summary) markDiagnosticStage(trace, 'parse', { source, ...summary });
      const unconfirmed = fields.isConfirmed === false;
      finishDiagnosticTrace(
        trace,
        summary?.isParseEmpty
          ? summary.validCount
            ? 'partial'
            : 'failure'
          : unconfirmed || summary?.hasDegradation
            ? 'partial'
            : 'success',
        {
          source,
          ...fields,
          ...(summary?.isParseEmpty ? { reason: 'parse_empty' } : unconfirmed ? { reason: 'unconfirmed' } : {})
        }
      );
      return result;
    } catch (error) {
      finishNotificationFailure(trace, source, error);
      throw error;
    }
  };

  const listPage = async (
    source: NotificationSource,
    options: {
      cursor?: string | null;
      categoryId?: string;
      expectedIdentityKey?: string;
      expectedSessionEpoch?: number;
      limit?: number;
      signal?: AbortSignal;
      unreadOnly?: boolean;
    } = {}
  ) =>
    runWithAccess(
      source,
      'notification-list',
      options,
      async (access, adapter) => {
        const page = await adapter.listPage({
          ...access,
          categoryId: options.categoryId,
          cursor: options.cursor,
          limit: options.limit,
          unreadOnly: options.unreadOnly
        });
        const nextCursor = nextPageCursor(page.hasMore, page.cursor, options.cursor);
        const hasMore = nextCursor !== undefined;
        const summary = sourceDiagnosticSummary(page);
        const quality = page.hasMore && !hasMore && page.quality === 'complete' ? 'partial' : page.quality;
        return annotateSourceDiagnosticSummary(
          { ...page, quality, cursor: nextCursor ?? null, hasMore },
          {
            parserVariant:
              source === 'nodeseek'
                ? 'nodeseek-notifications'
                : source === 'linuxdo'
                  ? 'discourse-notifications'
                  : 'yaohuo-notifications',
            ...summary,
            hasRepeatedCursor: Boolean(page.hasMore && page.cursor && page.cursor === options.cursor),
            hasDegradation: summary?.hasDegradation || (page.hasMore && !hasMore)
          }
        );
      },
      (page) => ({ itemCount: page.items.length, hasMore: page.hasMore, hasNextCursor: Boolean(page.cursor) })
    );

  return {
    listPage,

    async getCategories(source: NotificationSource, expectedIdentityKey?: string, signal?: AbortSignal) {
      return runWithAccess(
        source,
        'notification-categories',
        { signal, expectedIdentityKey },
        (access, adapter) => adapter.getCategories(access),
        (categories) => ({ itemCount: categories.length })
      );
    },

    async listAllPage(options: {
      cursors?: Partial<Record<NotificationSource, string | null>>;
      limit?: number;
      signal?: AbortSignal;
      sources: readonly NotificationSource[];
      unreadOnly?: boolean;
    }): Promise<NotificationBatchPage> {
      const requests = options.sources
        .filter((source) => options.cursors?.[source] !== null)
        .map((source) => ({ source, epoch: currentEpoch(source) }));
      const settled = await Promise.allSettled(
        requests.map(({ source, epoch }) =>
          listPage(source, {
            cursor: options.cursors?.[source],
            expectedSessionEpoch: epoch,
            limit: options.limit,
            signal: options.signal,
            unreadOnly: options.unreadOnly
          })
        )
      );
      const pages: Partial<Record<NotificationSource, NotificationPage>> = {};
      const errors: NotificationBatchResult['errors'] = {};
      const nextCursors: NotificationBatchPage['nextCursors'] = Object.fromEntries(
        options.sources.map((source) => [source, null])
      );
      const qualities: NotificationBatchPage['qualities'] = {};
      settled.forEach((result, index) => {
        const { source, epoch } = requests[index]!;
        if (currentEpoch(source) !== epoch) {
          qualities[source] = 'invalid';
          errors[source] = sourceErrorFromUnknown(source, staleNotificationAccess(source));
          return;
        }
        if (result.status === 'fulfilled') {
          qualities[source] = result.value.quality;
          if (result.value.quality !== 'invalid') pages[source] = result.value;
          const error = notificationPageError(result.value.quality);
          if (error) errors[source] = sourceErrorFromUnknown(source, error);
          nextCursors[source] = result.value.hasMore ? result.value.cursor : null;
          if (error) nextCursors[source] = null;
        } else {
          qualities[source] = 'invalid';
          errors[source] = sourceErrorFromUnknown(source, result.reason);
          nextCursors[source] = null;
        }
      });
      return {
        items: requests.flatMap(({ source }) => pages[source]?.items || []),
        errors,
        qualities,
        nextCursors,
        hasMore: Object.values(nextCursors).some((cursor) => cursor !== null)
      };
    },

    async readUnreadSnapshot(
      source: NotificationSource,
      options: { expectedIdentityKey?: string; expectedSessionEpoch?: number; signal?: AbortSignal } = {}
    ) {
      return runWithAccess(
        source,
        'notification-unread',
        options,
        (access, adapter) => adapter.readUnreadSnapshot(access),
        (snapshot) => ({ count: snapshot.total })
      );
    },

    async loadDetail(
      item: ForumNotification,
      expectedIdentityKey: string,
      signal?: AbortSignal,
      parentTrace?: DiagnosticTrace
    ): Promise<NotificationDetail> {
      return runWithAccess(
        item.source,
        'notification-detail',
        { signal, expectedIdentityKey },
        (access, adapter) => adapter.loadDetail(item, access),
        (detail) => ({
          hasContent: Boolean(detail.contentHtml || detail.contentText || detail.messages?.length),
          itemCount: detail.messages?.length || 0,
          hasTopic: Boolean(detail.topic),
          canReply: Boolean(detail.reply && !detail.reply.disabledReason)
        }),
        parentTrace
      );
    },

    async loadEarlierMessages(
      item: ForumNotification,
      cursor: string,
      expectedIdentityKey: string,
      signal?: AbortSignal
    ): Promise<NotificationMessagePage> {
      return runWithAccess(
        item.source,
        'notification-history',
        { signal, expectedIdentityKey },
        async (access, adapter) => {
          const load = adapter.loadEarlierMessages;
          if (!load) throw new Error('该来源暂不支持会话历史分页');
          if (!cursor) throw new Error('私信历史游标不正确');
          return load(item, cursor, access);
        },
        (page) => ({ itemCount: page.messages.length, hasMore: Boolean(page.olderCursor) })
      );
    },

    async setPolicyAcceptance(
      item: ForumNotification,
      policy: DiscoursePostPolicy,
      accepted: boolean,
      expectedIdentityKey: string,
      signal?: AbortSignal
    ) {
      return runWithAccess(
        item.source,
        'notification-policy',
        { signal, expectedIdentityKey },
        async (access) => {
          if (
            item.source !== 'linuxdo' ||
            item.target.type !== 'topic-post' ||
            (item.target.postId && item.target.postId !== policy.postId)
          ) {
            throw new Error('公告帖子信息不匹配，请重新打开公告');
          }
          return setLinuxDoPolicyAcceptance({ ...access, policy, accepted });
        },
        (result) => ({ isConfirmed: result.confirmed })
      );
    },

    async markRead(
      item: ForumNotification,
      detail: NotificationDetail,
      expectedIdentityKey: string,
      signal?: AbortSignal
    ) {
      return runWithAccess(
        item.source,
        'notification-mark-read',
        { signal, expectedIdentityKey },
        (access, adapter) => adapter.markRead(item, detail, access),
        (result) => ({ isConfirmed: result.confirmed })
      );
    },

    async replyToConversation(
      item: ForumNotification,
      content: string,
      expectedIdentityKey: string,
      signal?: AbortSignal,
      dispatchState?: RequestDispatchState
    ) {
      return runWithAccess(
        item.source,
        'notification-reply',
        { signal, expectedIdentityKey },
        async (access, adapter) => {
          if (!content.trim()) throw new Error('请输入回复内容');
          assertNotAborted(signal);
          const fetcher = access.fetcher;
          const trackedWrite = withRequestBeforeSend(fetcher, () => assertNotAborted(signal), dispatchState);
          return adapter.replyToConversation(item, content, {
            ...access,
            fetcher: (url, init) => (init?.method?.toUpperCase() === 'POST' ? trackedWrite : fetcher)(url, init)
          });
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
        beforeSend?: () => void;
        signal?: AbortSignal;
      }
    ) {
      return runWithAccess(source, 'notification-upload', options, async (access) => {
        if (source === 'yaohuo') throw new Error('妖火私信仅支持纯文本');
        assertNotAborted(options.signal);
        let imageUrl: string;
        if (source === 'nodeseek') {
          imageUrl = await uploadNodeSeekReplyImage({
            apiKey: options.nodeImageApiKey || '',
            file: options.file,
            fetcher: options.beforeSend ? withRequestBeforeSend(access.fetcher, options.beforeSend) : access.fetcher,
            signal: options.signal,
            timeoutMs: access.timeoutMs
          });
        } else {
          const request = buildDiscourseActionRequest({ type: 'upload', file: options.file });
          const data = await runLinuxDoAction({
            fetcher: access.fetcher,
            request,
            signal: options.signal,
            timeoutMs: access.timeoutMs,
            userAgent: access.userAgent
          });
          imageUrl = discourseImageUrlFromUploadResponse(data, LINUXDO_BASE_URL, 'linux.do');
        }
        assertNotAborted(options.signal);
        return { markup: replyImageMarkupForSource(source, imageUrl, options.file.name) };
      });
    },

    async resolveLinuxDoUpload(shortUrl: string, expectedIdentityKey: string, signal?: AbortSignal) {
      return runWithAccess('linuxdo', 'image-load', { signal, expectedIdentityKey }, (access) =>
        resolveLinuxDoUpload({
          shortUrl,
          fetcher: access.fetcher,
          signal,
          userAgent: access.userAgent || ''
        })
      );
    },
    async loadLinuxDoPollCapabilities(expectedIdentityKey: string, signal?: AbortSignal) {
      return runWithAccess('linuxdo', 'notification-poll-capabilities', { signal, expectedIdentityKey }, (access) =>
        fetchLinuxDoPollCapabilities({
          fetcher: access.fetcher,
          signal,
          userAgent: access.userAgent || ''
        })
      );
    },

    async loadLinuxDoTemplates(expectedIdentityKey: string, signal?: AbortSignal) {
      return runWithAccess('linuxdo', 'notification-templates', { signal, expectedIdentityKey }, (access) =>
        fetchLinuxDoTemplates({
          fetcher: access.fetcher,
          signal,
          userAgent: access.userAgent || ''
        })
      );
    },

    async recordLinuxDoTemplateUse(id: string, expectedIdentityKey: string, signal?: AbortSignal) {
      return runWithAccess('linuxdo', 'notification-template-use', { signal, expectedIdentityKey }, (access) =>
        recordLinuxDoTemplateUsage({
          fetcher: access.fetcher,
          id,
          signal,
          userAgent: access.userAgent || ''
        })
      );
    },

    async markAllRead(source: NotificationSource, expectedIdentityKey: string, signal?: AbortSignal) {
      return runWithAccess(
        source,
        'notification-mark-all-read',
        { signal, expectedIdentityKey },
        async (access, adapter) => {
          const markAllRead = adapter.markAllRead;
          return markAllRead ? markAllRead(access) : { confirmed: false, message: '该站点需要逐条打开消息' };
        },
        (result) => ({ isConfirmed: result.confirmed })
      );
    }
  };
}
