import type { Fetcher } from '../../src/platform/network/request';
import { registerForumReadResponseEvidence } from '../../src/sources/forumSourceReadAttempt';

export function forumReadEvidenceFetcher(commit: () => Promise<unknown>): Fetcher {
  return async (_input, init) => {
    const response = new Response('{}');
    registerForumReadResponseEvidence(init, response, {
      commit,
      kind: 'fallback',
      ordinal: 1,
      source: 'nodeseek'
    });
    return response;
  };
}
