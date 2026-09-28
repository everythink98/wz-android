import {
  getNodeSeekCurrentUserIdentity,
  getNodeSeekReplies,
  getNodeSeekTopic,
  getNodeSeekUserDetails,
  getNodeSeekUserTopics,
  getNodeSeekUserReplies
} from '@/sources/nodeseek/reader';
import { getYaohuoUserDetails, getYaohuoUserTopics, getYaohuoUserReplies } from '@/sources/yaohuo/user';
import { getV2exReplies, getV2exTopic } from '@/sources/v2ex/reader';
import { getV2exUserDetails, getV2exUserTopics, getV2exUserReplies } from '@/sources/v2ex/account';
import { checkYaohuoLoginDirect, getYaohuoTopicDirect, getYaohuoRepliesDirect } from '@/sources/yaohuo/reader';
import { getLinuxDoReplies, getLinuxDoReply, getLinuxDoTopic, type LinuxDoReadAuth } from '@/sources/linuxdo/reader';
import {
  getLinuxDoCurrentUserIdentity,
  getLinuxDoUserDetails,
  getLinuxDoUserTopics,
  getLinuxDoUserReplies
} from '@/sources/linuxdo/account';
import { isDiscourseSource } from '@/domain/forum/sourceCatalog';
import type {
  Reply,
  RepliesResponse,
  ReplyOrder,
  ReplyWindowPosition,
  Source,
  Topic,
  TopicDetail,
  UserIdentity,
  UserDetails
} from '@/domain/forum/models';
import { type Fetcher } from '@/platform/network/request';
import type { DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import { dispatchSourceRead } from './readAggregation';
export function getTopic({
  source,
  id,
  topic,
  fetcher,
  nodeSeekAuthenticated,
  nodeSeekUserAgent,
  discourseAuth,
  diagnosticTrace,
  trackVisit,
  signal,
  timeoutMs
}: {
  source: Source;
  id: string;
  topic?: Topic;
  fetcher?: Fetcher;
  nodeSeekAuthenticated?: boolean;
  nodeSeekUserAgent?: string;
  discourseAuth?: LinuxDoReadAuth;
  diagnosticTrace?: DiagnosticTrace;
  trackVisit?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<TopicDetail> {
  if (source === 'yaohuo') {
    if (!topic) throw new Error('妖火详情需要主题上下文');
    return getYaohuoTopicDirect({ topic, yaohuoFetcher: fetcher, signal, timeoutMs });
  }
  const options = { authenticated: nodeSeekAuthenticated, fetcher, nodeSeekUserAgent, signal, timeoutMs };
  if (isDiscourseSource(source)) {
    return getLinuxDoTopic(id, {
      linuxDoAccess: discourseAuth,
      trackVisit,
      trackView: trackVisit,
      fetcher,
      signal,
      timeoutMs
    });
  }
  return dispatchSourceRead(source, {
    nodeseek: () => getNodeSeekTopic(id, options, diagnosticTrace),
    v2ex: () => getV2exTopic(id, options)
  });
}

export function getReplies({
  source,
  id,
  categoryId,
  order,
  position,
  limit = source === 'yaohuo' ? 30 : 20,
  fetcher,
  nodeSeekAuthenticated,
  nodeSeekUserAgent,
  discourseAuth,
  fillPages,
  replyCount,
  signal,
  timeoutMs
}: {
  source: Source;
  id: string;
  categoryId?: string;
  order: ReplyOrder;
  position: ReplyWindowPosition;
  limit?: number;
  fetcher?: Fetcher;
  nodeSeekAuthenticated?: boolean;
  nodeSeekUserAgent?: string;
  discourseAuth?: LinuxDoReadAuth;
  fillPages?: boolean;
  replyCount?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<RepliesResponse> {
  const options = {
    authenticated: nodeSeekAuthenticated,
    order,
    position,
    limit,
    fetcher,
    nodeSeekUserAgent,
    fillPages,
    replyCount,
    signal,
    timeoutMs
  };
  if (isDiscourseSource(source)) {
    return getLinuxDoReplies(id, {
      linuxDoAccess: discourseAuth,
      fetcher,
      limit,
      order,
      position,
      signal,
      timeoutMs
    });
  }
  return dispatchSourceRead<RepliesResponse>(source, {
    nodeseek: () => getNodeSeekReplies(id, options),
    v2ex: () => getV2exReplies(id, options),
    yaohuo: () =>
      getYaohuoRepliesDirect({
        id,
        categoryId,
        order,
        position,
        limit,
        replyCount,
        yaohuoFetcher: fetcher,
        signal,
        timeoutMs
      })
  });
}

export function getReply({
  source,
  id,
  floor,
  fetcher,
  discourseAuth,
  signal,
  timeoutMs
}: {
  source: Source;
  id: string;
  floor: number;
  fetcher?: Fetcher;
  discourseAuth?: LinuxDoReadAuth;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<Reply> {
  if (!isDiscourseSource(source)) {
    throw new Error('该来源不支持按楼层读取引用');
  }
  return getLinuxDoReply(id, floor, {
    linuxDoAccess: discourseAuth,
    fetcher,
    signal,
    timeoutMs
  });
}

// Local interfaces split the existing canonical profile and activity fields.
export type UserReadOptions = {
  source: Source;
  id: string;
  username?: string;
  fetcher?: Fetcher;
  nodeSeekAuthenticated?: boolean;
  nodeSeekUserAgent?: string;
  discourseAuth?: LinuxDoReadAuth;
  signal?: AbortSignal;
  timeoutMs?: number;
};
export type UserActivityReadOptions = Omit<UserReadOptions, 'id' | 'username'> & {
  profile: UserDetails;
  cursor?: string | null;
};

export function getUserDetails(options: UserReadOptions): Promise<UserDetails> {
  const { source, id, username, discourseAuth, nodeSeekAuthenticated, ...request } = options;
  return dispatchSourceRead(source, {
    linuxdo: () => getLinuxDoUserDetails(id, username || id, { ...request, linuxDoAccess: discourseAuth }),
    nodeseek: () => getNodeSeekUserDetails(id, { ...request, authenticated: nodeSeekAuthenticated }),
    v2ex: () => getV2exUserDetails(id, username || id, request),
    yaohuo: () => getYaohuoUserDetails(id, username, request)
  });
}

export function getUserTopics(options: UserActivityReadOptions) {
  const { source, profile, discourseAuth, nodeSeekAuthenticated, ...request } = options;
  if (profile.source !== source) throw new Error('用户活动来源不匹配');
  return dispatchSourceRead(source, {
    linuxdo: () => getLinuxDoUserTopics(profile, { ...request, linuxDoAccess: discourseAuth }),
    nodeseek: () => getNodeSeekUserTopics(profile, { ...request, authenticated: nodeSeekAuthenticated }),
    v2ex: () => getV2exUserTopics(profile, request),
    yaohuo: () => getYaohuoUserTopics(profile, request)
  });
}

export function getUserReplies(options: UserActivityReadOptions) {
  const { source, profile, discourseAuth, nodeSeekAuthenticated, ...request } = options;
  if (profile.source !== source) throw new Error('用户活动来源不匹配');
  return dispatchSourceRead(source, {
    linuxdo: () => getLinuxDoUserReplies(profile, { ...request, linuxDoAccess: discourseAuth }),
    nodeseek: () => getNodeSeekUserReplies(profile, { ...request, authenticated: nodeSeekAuthenticated }),
    v2ex: () => getV2exUserReplies(profile, request),
    yaohuo: () => getYaohuoUserReplies(profile, request)
  });
}

export function getCurrentUserIdentity({
  source,
  fetcher,
  discourseAuth,
  nodeSeekAuthenticated,
  nodeSeekUserAgent,
  signal,
  timeoutMs
}: {
  source: Source;
  fetcher?: Fetcher;
  discourseAuth?: LinuxDoReadAuth;
  nodeSeekAuthenticated?: boolean;
  nodeSeekUserAgent?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<UserIdentity> {
  if (isDiscourseSource(source)) {
    return getLinuxDoCurrentUserIdentity({
      linuxDoUserAgent: discourseAuth?.userAgent,
      fetcher,
      signal,
      timeoutMs
    });
  }
  return dispatchSourceRead(source, {
    nodeseek: () =>
      getNodeSeekCurrentUserIdentity({
        authenticated: nodeSeekAuthenticated,
        fetcher,
        nodeSeekUserAgent,
        signal,
        timeoutMs
      }),
    v2ex: () => {
      throw new Error('V2EX 不支持当前登录身份读取');
    },
    yaohuo: async () => {
      const check = await checkYaohuoLoginDirect({
        yaohuoFetcher: fetcher,
        signal,
        timeoutMs
      });
      if (check.currentUser) {
        return check.currentUser;
      }
      if (check.loginRequired) {
        throw Object.assign(new Error(check.message || '妖火登录已失效，请重新登录。'), {
          source: 'yaohuo',
          loginRequired: true,
          reason: check.reason,
          loginUrl: check.loginUrl
        });
      }
      throw new Error('无法读取当前妖火用户身份，请重新检测妖火登录状态。');
    }
  });
}
