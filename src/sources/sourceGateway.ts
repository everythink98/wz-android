export {
  getCategories,
  getFeed,
  getReply,
  getReplies,
  getTopic,
  getUserProfile,
  searchTopics
} from '../forumApi';
import {
  checkYaohuoLoginDirect,
  getYaohuoFeedDirect,
  getYaohuoRepliesDirect,
  getYaohuoTopicDirect,
  searchYaohuoDirect
} from '../yaohuoApi';
export {
  checkLinuxDoLoginAccess,
  runLinuxDoAction
} from '../linuxdoActionClient';
export {
  getLinuxDoLevelProfile,
  type LinuxDoLevelProfile
} from '../linuxdoLevel';
export { runNodeSeekAction } from '../nodeseekActionClient';
export { runYaohuoAction } from '../yaohuoActionClient';

export function getYaohuoFeed(options: Parameters<typeof getYaohuoFeedDirect>[0]) {
  return getYaohuoFeedDirect(options);
}

export function searchYaohuoTopics(options: Parameters<typeof searchYaohuoDirect>[0]) {
  return searchYaohuoDirect(options);
}

export function getYaohuoTopic(options: Parameters<typeof getYaohuoTopicDirect>[0]) {
  return getYaohuoTopicDirect(options);
}

export function getYaohuoReplies(options: Parameters<typeof getYaohuoRepliesDirect>[0]) {
  return getYaohuoRepliesDirect(options);
}

export function checkYaohuoLogin(options: Parameters<typeof checkYaohuoLoginDirect>[0]) {
  return checkYaohuoLoginDirect(options);
}
