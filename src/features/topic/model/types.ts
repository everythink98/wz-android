import type { ReplyWindowPosition } from '@/domain/forum/models';
import type { WritableSessionTicket } from '@/domain/session/writableSessionGate';

export type ReplyFilter = 'all' | 'author' | 'images';

export interface ReplyTarget {
  floor: number;
  author?: string;
  authorId?: string;
}

export interface ReplyEditTarget {
  commentId: number;
  floor?: number;
  contentMarkdown: string;
  topicId: string;
  ticket: WritableSessionTicket;
}

export type ReplyCommentIdRefreshTarget = { kind: 'comment-id'; commentId: number };

export type ReplyRefreshTarget = ReplyCommentIdRefreshTarget | { kind: 'delete-path'; deletePath: string };

export type ReplyCursor = Extract<ReplyWindowPosition, { kind: 'cursor' }>;

export type ReplyRefreshCommand =
  | { kind: 'manual'; silent?: boolean }
  | {
      kind: 'created';
      nodeSeekAuthorId?: string;
      nodeSeekContentMarkdown?: string;
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
