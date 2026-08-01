import type { SessionSource } from '@/domain/forum/sourceCatalog';

export type ForumSessionEpochs = Readonly<Record<SessionSource, number>>;

export const initialForumSessionEpochs: ForumSessionEpochs = {
  linuxdo: 0,
  nodeseek: 0,
  xiaoyinsi: 0,
  yaohuo: 0
};
