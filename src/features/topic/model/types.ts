import type { Reply, ReplyWindowPosition } from '@/domain/forum/models';
import type { WritableSessionTicket } from '@/domain/session/writableSessionGate';

export type ReplyFilter = 'all' | 'author' | 'images';

export interface ReplyTarget {
  floor: number;
  author?: string;
  authorId?: string;
  commentId?: number;
}

export interface ReplyEditTarget {
  commentId: number;
  floor?: number;
  contentMarkdown: string;
  topicId: string;
  ticket: WritableSessionTicket;
}

export type ReplyRefreshTarget = Pick<Reply, 'commentId' | 'floor' | 'deletePath'>;

export type ReplyCursor = Extract<ReplyWindowPosition, { kind: 'cursor' }>;

export type ReplyRefreshCommand =
  | { kind: 'manual'; silent?: boolean }
  | { kind: 'created'; silent?: boolean }
  | {
      kind: 'edited';
      target: ReplyRefreshTarget;
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
