import { describe, expect, it, vi } from 'vitest';
import type { AccountStatusObservation } from '@/domain/session/siteSessionState';
import type { Fetcher } from '@/platform/network/request';

const accountStatusMocks = vi.hoisted(() => ({
  linuxdo: vi.fn(),
  nodeseek: vi.fn()
}));

vi.mock('expo-secure-store', () => ({
  deleteItemAsync: vi.fn(async () => undefined),
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined)
}));

vi.mock('react-native', () => ({ NativeModules: {} }));

vi.mock('@/sources/linuxdo/accountStatus', () => ({
  readLinuxDoAccountStatus: accountStatusMocks.linuxdo
}));

vi.mock('@/sources/nodeseek/accountStatus', () => ({
  readNodeSeekAccountStatus: accountStatusMocks.nodeseek
}));

import { acceptForumReadResponse, registerForumReadResponseEvidence } from './forumSourceReadAttempt';
import { readAccountStatus } from './accountRead';

describe('forum Account read-attempt ownership', () => {
  it('[REG-PERF-019] turns only a raw Account HTTP 401 into terminal anonymous evidence', async () => {
    accountStatusMocks.nodeseek.mockRejectedValueOnce(
      Object.assign(new Error('登录状态已失效'), { status: 401, reason: 'http-401' })
    );
    const options = {
      fetcher: vi.fn<Fetcher>(),
      linuxDoUserAgent: 'LinuxDo UA',
      nodeSeekUserAgent: 'NodeSeek UA',
      readManagedCookieHeader: async () => ({ status: 'ok' as const, header: '' }),
      signal: new AbortController().signal
    };

    await expect(readAccountStatus('nodeseek', options)).resolves.toMatchObject({
      session: { site: 'nodeseek', status: 'expired' }
    });

    accountStatusMocks.nodeseek.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { status: 403 }));
    await expect(readAccountStatus('nodeseek', options)).rejects.toMatchObject({ status: 403 });
  });

  it.each(['linuxdo', 'nodeseek'] as const)(
    '[REG-SOURCE-009] does not commit a parsed %s fallback after its Account signal is canceled',
    async (source) => {
      const controller = new AbortController();
      const parsed = Promise.withResolvers<void>();
      const finishAuxiliaryWork = Promise.withResolvers<void>();
      const recoverReadChannel = vi.fn(async () => undefined);
      const fetcher: Fetcher = async (_input, init) => {
        const response = new Response('{}');
        registerForumReadResponseEvidence(init, response, {
          commit: recoverReadChannel,
          kind: 'fallback',
          ordinal: 1,
          source
        });
        return response;
      };
      const observation: AccountStatusObservation = {
        session: {
          site: source,
          status: 'anonymous',
          cookieSummary: [],
          isVerifying: false
        }
      };
      const statusReader = accountStatusMocks[source];
      statusReader.mockImplementationOnce(async ({ fetcher: scopedFetcher }: { fetcher: Fetcher }) => {
        const response = await scopedFetcher(`https://${source}.example/session`);
        acceptForumReadResponse(response);
        parsed.resolve();
        await finishAuxiliaryWork.promise;
        return observation;
      });
      const read = readAccountStatus(source, {
        fetcher,
        linuxDoUserAgent: 'LinuxDo UA',
        nodeSeekUserAgent: 'NodeSeek UA',
        readManagedCookieHeader: async () => ({ status: 'ok', header: '' }),
        signal: controller.signal
      });
      await parsed.promise;

      controller.abort();
      finishAuxiliaryWork.resolve();

      await expect(read).resolves.toBe(observation);
      expect(recoverReadChannel).not.toHaveBeenCalled();
    }
  );
});
