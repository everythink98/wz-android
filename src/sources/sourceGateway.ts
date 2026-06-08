import {
  getCategories as getForumCategories,
  getFeed as getForumFeed,
  getReply as getForumReply,
  getReplies as getForumReplies,
  getTopic as getForumTopic,
  getUserProfile as getForumUserProfile,
  searchTopics as searchForumTopics
} from '../forumApi';
import {
  checkLinuxDoLoginAccess as checkLinuxDoLoginAccessViaClient,
  runLinuxDoAction as runLinuxDoActionViaClient
} from '../linuxdoActionClient';
import {
  getLinuxDoLevelProfile as getLinuxDoLevelProfileViaClient,
  type LinuxDoLevelProfile
} from '../linuxdoLevel';
import {
  runNodeSeekAction as runNodeSeekActionViaClient
} from '../nodeseekActionClient';
import {
  checkYaohuoLoginDirect as checkYaohuoLoginViaDirectApi,
  getYaohuoFeedDirect as getYaohuoFeedViaDirectApi,
  getYaohuoRepliesDirect as getYaohuoRepliesViaDirectApi,
  getYaohuoTopicDirect as getYaohuoTopicViaDirectApi,
  searchYaohuoDirect as searchYaohuoViaDirectApi
} from '../yaohuoApi';
import {
  runYaohuoAction as runYaohuoActionViaClient
} from '../yaohuoActionClient';

export type { LinuxDoLevelProfile };

export function getFeed(...args: Parameters<typeof getForumFeed>): ReturnType<typeof getForumFeed> {
  return getForumFeed(...args);
}

export function getCategories(...args: Parameters<typeof getForumCategories>): ReturnType<typeof getForumCategories> {
  return getForumCategories(...args);
}

export function getTopic(...args: Parameters<typeof getForumTopic>): ReturnType<typeof getForumTopic> {
  return getForumTopic(...args);
}

export function getReplies(...args: Parameters<typeof getForumReplies>): ReturnType<typeof getForumReplies> {
  return getForumReplies(...args);
}

export function getReply(...args: Parameters<typeof getForumReply>): ReturnType<typeof getForumReply> {
  return getForumReply(...args);
}

export function getUserProfile(...args: Parameters<typeof getForumUserProfile>): ReturnType<typeof getForumUserProfile> {
  return getForumUserProfile(...args);
}

export function searchTopics(...args: Parameters<typeof searchForumTopics>): ReturnType<typeof searchForumTopics> {
  return searchForumTopics(...args);
}

export function checkLinuxDoLoginAccess(...args: Parameters<typeof checkLinuxDoLoginAccessViaClient>): ReturnType<typeof checkLinuxDoLoginAccessViaClient> {
  return checkLinuxDoLoginAccessViaClient(...args);
}

export function runLinuxDoAction(...args: Parameters<typeof runLinuxDoActionViaClient>): ReturnType<typeof runLinuxDoActionViaClient> {
  return runLinuxDoActionViaClient(...args);
}

export function getLinuxDoLevelProfile(...args: Parameters<typeof getLinuxDoLevelProfileViaClient>): ReturnType<typeof getLinuxDoLevelProfileViaClient> {
  return getLinuxDoLevelProfileViaClient(...args);
}

export function runNodeSeekAction(...args: Parameters<typeof runNodeSeekActionViaClient>): ReturnType<typeof runNodeSeekActionViaClient> {
  return runNodeSeekActionViaClient(...args);
}

export function checkYaohuoLoginDirect(...args: Parameters<typeof checkYaohuoLoginViaDirectApi>): ReturnType<typeof checkYaohuoLoginViaDirectApi> {
  return checkYaohuoLoginViaDirectApi(...args);
}

export function getYaohuoFeedDirect(...args: Parameters<typeof getYaohuoFeedViaDirectApi>): ReturnType<typeof getYaohuoFeedViaDirectApi> {
  return getYaohuoFeedViaDirectApi(...args);
}

export function getYaohuoRepliesDirect(...args: Parameters<typeof getYaohuoRepliesViaDirectApi>): ReturnType<typeof getYaohuoRepliesViaDirectApi> {
  return getYaohuoRepliesViaDirectApi(...args);
}

export function getYaohuoTopicDirect(...args: Parameters<typeof getYaohuoTopicViaDirectApi>): ReturnType<typeof getYaohuoTopicViaDirectApi> {
  return getYaohuoTopicViaDirectApi(...args);
}

export function searchYaohuoDirect(...args: Parameters<typeof searchYaohuoViaDirectApi>): ReturnType<typeof searchYaohuoViaDirectApi> {
  return searchYaohuoViaDirectApi(...args);
}

export function runYaohuoAction(...args: Parameters<typeof runYaohuoActionViaClient>): ReturnType<typeof runYaohuoActionViaClient> {
  return runYaohuoActionViaClient(...args);
}
