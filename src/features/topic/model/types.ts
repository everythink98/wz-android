import type { Reply, ReplyWindowPosition } from '@/domain/forum/models';
import type { WritableSessionTicket } from '@/domain/session/writableSessionGate';

export type ReplyFilter = 'all' | 'author' | 'images';

export interface ReplyTarget {
  floor: number;
  author?: string;
  authorId?: string;
}

export type ReplyEditSnapshot = Pick<
  Reply,
  'author' | 'authorId' | 'authorUrl' | 'contentHtml' | 'createdAt' | 'floor'
>;

export interface ReplyEditTarget {
  commentId: number;
  floor?: number;
  contentMarkdown: string;
  topicId: string;
  ticket: WritableSessionTicket;
  cachedReply?: ReplyEditSnapshot;
}

type ReplyCommentIdRefreshTarget = { kind: 'comment-id'; commentId: number };

export type ReplyRefreshTarget = ReplyCommentIdRefreshTarget | { kind: 'delete-path'; deletePath: string };

type ReplyCursor = Extract<ReplyWindowPosition, { kind: 'cursor' }>;

export type ReplyRefreshCommand =
  | { kind: 'manual'; silent?: boolean }
  | {
      kind: 'created';
      createdTarget?: { floor: number; commentId?: number; pageHint?: number };
      silent?: boolean;
    }
  | {
      kind: 'edited';
      target: ReplyCommentIdRefreshTarget;
      contentMarkdown: string;
      position?: ReplyCursor;
      silent?: boolean;
    }
  | {
      kind: 'deleted';
      target: ReplyRefreshTarget;
      position?: ReplyCursor;
      silent?: boolean;
    };
