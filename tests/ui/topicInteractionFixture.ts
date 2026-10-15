import { queryOptions } from '@tanstack/react-query';
import type { DiscourseInteractionConfig } from '@/domain/forum/discourseInteractions';
import { forumQueryKeys } from '@/platform/query/serverState';
import type { ReadGateway } from '@/sources/readGateway';

export const testLinuxDoInteractionConfig: DiscourseInteractionConfig = {
  reactionsEnabled: true,
  enabledReactions: ['heart', 'laughing', 'bili_057'],
  reactionForLike: 'heart',
  boostsEnabled: true,
  maxBoostsPerPost: 50
};
export function inactivePostInteractionActions() {
  return {
    boostComposer: null,
    openBoostComposer: (_postId: number) => {},
    closeBoostComposer: () => {},
    changeBoostContent: (_content: string) => {},
    submitBoost: async () => false,
    deleteBoost: (_postId: number, _boostId: number) => {},
    reactToPost: async (_postId: number, _reactionId?: string) => false,
    recheckLinuxDoPost: async (_postId: number) => false,
    loadLinuxDoInteractionConfig: async () => testLinuxDoInteractionConfig,
    linuxDoInteractionConfigQuery: queryOptions({
      queryKey: forumQueryKeys.interactionConfig(0),
      queryFn: async () => testLinuxDoInteractionConfig,
      staleTime: Infinity
    })
  };
}

export function testPostInteractionReads(): Pick<
  ReadGateway,
  'getLinuxDoInteractionConfig' | 'getEmojiUrls' | 'getReply'
> {
  return {
    getLinuxDoInteractionConfig: async () => testLinuxDoInteractionConfig,
    getEmojiUrls: async () => ({
      heart: 'https://linux.do/heart.png',
      laughing: 'https://linux.do/laughing.png',
      bili_057: 'https://linux.do/bili.png'
    }),
    getReply: async () => {
      throw new Error('Unexpected interaction reconciliation');
    }
  };
}
