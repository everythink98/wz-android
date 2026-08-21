import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runLinuxDoAction: vi.fn(async () => ({ ok: true }))
}));

vi.mock('@/sources/linuxdo/actionClient', () => ({ runLinuxDoAction: mocks.runLinuxDoAction }));
import { prepareDiscourseActionRuntime, type DiscourseActionRuntimeContext } from './discourseActionRuntime';

function runtimeContext(): DiscourseActionRuntimeContext {
  return {
    fetcher: vi.fn(),
    linuxDoUserAgent: () => 'test-agent'
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Discourse action runtime registry', () => {
  it('prepares the registered linux.do transport', async () => {
    const context = runtimeContext();
    const linuxdo = await prepareDiscourseActionRuntime('linuxdo', context);
    const request = {
      method: 'POST' as const,
      path: '/posts.json',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: 'body' })
    };

    await linuxdo.execute(request, new AbortController().signal);

    expect(mocks.runLinuxDoAction).toHaveBeenCalledOnce();
    expect(mocks.runLinuxDoAction).toHaveBeenCalledWith(
      expect.objectContaining({
        userAgent: 'test-agent'
      })
    );
  });

  it('[REG-ACCOUNT-026] reports linux.do expiry without mutating identity or Cookie state', async () => {
    const context = runtimeContext();
    const runtime = await prepareDiscourseActionRuntime('linuxdo', context);

    await expect(
      runtime.recover(
        Object.assign(new Error('linux.do 登录已失效'), {
          loginRequired: true,
          source: 'linuxdo'
        })
      )
    ).resolves.toMatchObject({
      loginRequired: true,
      message: 'linux.do 登录已失效'
    });
  });
});
