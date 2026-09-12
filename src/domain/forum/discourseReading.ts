import { isRecord } from './html';
import type { DiscourseTopicReading, ReadingAnchor, Reply } from './models';

const nonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function discourseReadingFromJson(raw: unknown): DiscourseTopicReading | undefined {
  if (!isRecord(raw) || !/^\d+$/.test(String(raw.id ?? ''))) return;
  if (raw.archetype === 'private_message') return;
  if (!Object.hasOwn(raw, 'last_read_post_number') && !Object.hasOwn(raw, 'highest_post_number')) return;
  const posts = isRecord(raw.post_stream) && Array.isArray(raw.post_stream.posts) ? raw.post_stream.posts : [];
  return {
    topicId: String(raw.id),
    ...(raw.last_read_post_number === null || nonNegativeInteger(raw.last_read_post_number)
      ? { lastReadPostNumber: raw.last_read_post_number }
      : {}),
    ...(nonNegativeInteger(raw.highest_post_number) && raw.highest_post_number > 0
      ? { highestPostNumber: raw.highest_post_number }
      : {}),
    ...(nonNegativeInteger(raw.unread_posts) ? { unreadPosts: raw.unread_posts } : {}),
    readPostNumbers: posts.flatMap((post) =>
      isRecord(post) && post.read === true && nonNegativeInteger(post.post_number) && post.post_number > 0
        ? [post.post_number]
        : []
    )
  };
}

export interface DiscourseReadingEntry {
  server: DiscourseTopicReading;
  visited: boolean;
  anchor?: ReadingAnchor;
  highestKnown: number;
  localVersion: number;
  requestSequence: number;
  readPosts: Record<number, true>;
}

export type DiscourseReadingState = Readonly<Record<string, DiscourseReadingEntry>>;
export type DiscourseVisitedState = Readonly<Record<string, { visited: boolean; hasNewReplies?: boolean }>>;
export function selectDiscourseVisited(state: DiscourseReadingState): DiscourseVisitedState {
  return Object.fromEntries(
    Object.entries(state).map(([id, entry]) => [
      id,
      {
        visited: entry.visited,
        hasNewReplies: entry.highestKnown > 0 && (entry.server.highestPostNumber || 0) > entry.highestKnown
      }
    ])
  );
}
export const EMPTY_DISCOURSE_READING_STATE: DiscourseReadingState = {};

export function findReadingResumeReply(replies: readonly Reply[], floor: number) {
  const available = replies
    .filter(
      (reply) =>
        Number.isSafeInteger(reply.floor) &&
        reply.floor! > 1 &&
        !reply.hidden &&
        !reply.systemAction &&
        !reply.replyLocationConflict
    )
    .sort((a, b) => a.floor! - b.floor!);
  return available.find((reply) => reply.floor! >= floor) || available.at(-1);
}

export function readingResumeAnchor(entry: DiscourseReadingEntry | undefined): ReadingAnchor | undefined {
  if (entry?.anchor) return entry.anchor;
  const last = entry?.server.lastReadPostNumber;
  if (!last) return;
  return { floor: Math.min(last + 1, entry.server.highestPostNumber || last) };
}

export function mergeDiscourseReading(
  previous: DiscourseReadingEntry | undefined,
  incoming: DiscourseTopicReading,
  request: { sequence: number; localVersion: number },
  pending: boolean
): DiscourseReadingEntry {
  const current: DiscourseReadingEntry = previous || {
    server: { topicId: incoming.topicId },
    visited: false,
    highestKnown: 0,
    localVersion: 0,
    requestSequence: 0,
    readPosts: {}
  };
  if (request.sequence < current.requestSequence) return current;
  const last = incoming.lastReadPostNumber;
  const unchangedLocally = current.localVersion <= request.localVersion;
  const reset =
    unchangedLocally && !pending && last !== undefined && (last || 0) < (current.server.lastReadPostNumber || 0);
  const advancedElsewhere = unchangedLocally && (last || 0) > current.highestKnown;
  const readPosts = reset ? {} : { ...current.readPosts };
  incoming.readPostNumbers?.forEach((floor) => {
    readPosts[floor] = true;
  });
  return {
    ...current,
    server: {
      ...current.server,
      ...incoming,
      ...(!reset && last !== undefined && (last || 0) < (current.server.lastReadPostNumber || 0)
        ? { lastReadPostNumber: current.server.lastReadPostNumber }
        : {})
    },
    visited: current.visited || (last || 0) > 0 || Boolean(incoming.readPostNumbers?.length),
    anchor: reset || advancedElsewhere ? undefined : current.anchor,
    highestKnown: reset ? last || 0 : Math.max(current.highestKnown, unchangedLocally ? last || 0 : 0),
    requestSequence: request.sequence,
    readPosts
  };
}
