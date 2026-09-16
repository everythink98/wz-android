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
import { checkYaohuoLoginDirect } from '@/sources/yaohuo/reader';
import {
  getDiscourseCurrentUserIdentity,
  getDiscourseReplies,
  getDiscourseReply,
  getDiscourseTopic,
  getDiscourseUserDetails,
  getDiscourseUserTopics,
  getDiscourseUserReplies,
  type DiscourseReadAuth
} from './discourseRead';
import { isDiscourseSource } from '@/domain/forum/sourceCatalog';
import type {
  Reply,
  RepliesResponse,
  ReplyOrder,
  ReplyWindowPosition,
  Source,
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
  fetcher?: Fetcher;
  nodeSeekAuthenticated?: boolean;
  nodeSeekUserAgent?: string;
  discourseAuth?: DiscourseReadAuth;
  diagnosticTrace?: DiagnosticTrace;
  trackVisit?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<TopicDetail> {
  const options = { authenticated: nodeSeekAuthenticated, fetcher, nodeSeekUserAgent, signal, timeoutMs };
  if (isDiscourseSource(source)) {
    return getDiscourseTopic(id, {
      auth: discourseAuth,
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
  order,
  position,
  limit = 20,
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
  order: ReplyOrder;
  position: ReplyWindowPosition;
  limit?: number;
  fetcher?: Fetcher;
  nodeSeekAuthenticated?: boolean;
  nodeSeekUserAgent?: string;
  discourseAuth?: DiscourseReadAuth;
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
    return getDiscourseReplies(id, {
      auth: discourseAuth,
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
    v2ex: () => getV2exReplies(id, options)
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
  discourseAuth?: DiscourseReadAuth;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<Reply> {
  if (!isDiscourseSource(source)) {
    throw new Error('该来源不支持按楼层读取引用');
  }
  return getDiscourseReply(id, floor, {
    auth: discourseAuth,
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
  discourseAuth?: DiscourseReadAuth;
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
    linuxdo: () => getDiscourseUserDetails(id, username || id, { ...request, auth: discourseAuth }),
    nodeseek: () => getNodeSeekUserDetails(id, { ...request, authenticated: nodeSeekAuthenticated }),
    v2ex: () => getV2exUserDetails(id, username || id, request),
    yaohuo: () => getYaohuoUserDetails(id, username, request)
  });
}

export function getUserTopics(options: UserActivityReadOptions) {
  const { source, profile, discourseAuth, nodeSeekAuthenticated, ...request } = options;
  if (profile.source !== source) throw new Error('用户活动来源不匹配');
  return dispatchSourceRead(source, {
    linuxdo: () => getDiscourseUserTopics(profile, { ...request, auth: discourseAuth }),
    nodeseek: () => getNodeSeekUserTopics(profile, { ...request, authenticated: nodeSeekAuthenticated }),
    v2ex: () => getV2exUserTopics(profile, request),
    yaohuo: () => getYaohuoUserTopics(profile, request)
  });
}

export function getUserReplies(options: UserActivityReadOptions) {
  const { source, profile, discourseAuth, nodeSeekAuthenticated, ...request } = options;
  if (profile.source !== source) throw new Error('用户活动来源不匹配');
  return dispatchSourceRead(source, {
    linuxdo: () => getDiscourseUserReplies(profile, { ...request, auth: discourseAuth }),
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
  discourseAuth?: DiscourseReadAuth;
  nodeSeekAuthenticated?: boolean;
  nodeSeekUserAgent?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<UserIdentity> {
  if (isDiscourseSource(source)) {
    return getDiscourseCurrentUserIdentity({
      auth: discourseAuth,
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
