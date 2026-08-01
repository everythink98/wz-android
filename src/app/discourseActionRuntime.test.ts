import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  currentXiaoyinsiCredentialGeneration: vi.fn(() => 11),
  loadXiaoyinsiCredentials: vi.fn(),
  runLinuxDoAction: vi.fn(async () => ({ ok: true })),
  runXiaoyinsiAction: vi.fn(async () => ({ ok: true }))
}));

vi.mock('@/linuxdoActionClient', () => ({ runLinuxDoAction: mocks.runLinuxDoAction }));
vi.mock('@/xiaoyinsiActionClient', () => ({ runXiaoyinsiAction: mocks.runXiaoyinsiAction }));
vi.mock('@/xiaoyinsiAuth', () => ({
  currentXiaoyinsiCredentialGeneration: mocks.currentXiaoyinsiCredentialGeneration,
  loadXiaoyinsiCredentials: mocks.loadXiaoyinsiCredentials
}));
import {
  discourseActionRuntimeSources,
  prepareDiscourseActionRuntime,
  type DiscourseActionRuntimeContext
} from './discourseActionRuntime';

function runtimeContext(): DiscourseActionRuntimeContext {
  return {
    fetcher: vi.fn(),
    linuxDoUserAgent: () => 'test-agent',
    refreshXiaoyinsiAuthorization: vi.fn(async () => true),
    resetLinuxDoLevelState: vi.fn(),
    updateLinuxDoSession: vi.fn()
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadXiaoyinsiCredentials.mockResolvedValue({ apiKey: 'key', clientId: 'client' });
  mocks.currentXiaoyinsiCredentialGeneration.mockReturnValue(11);
});

describe('Discourse action runtime registry', () => {
  it('registers every current Discourse source outside the Topic controller', () => {
    expect(discourseActionRuntimeSources).toEqual(['linuxdo', 'xiaoyinsi']);
  });

  it('prepares the independent transport for each registered source', async () => {
    const context = runtimeContext();
    const linuxdo = await prepareDiscourseActionRuntime('linuxdo', context);
    const xiaoyinsi = await prepareDiscourseActionRuntime('xiaoyinsi', context);
    const request = {
      method: 'POST' as const,
      path: '/posts.json',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: 'body' })
    };

    await linuxdo.execute?.(request, new AbortController().signal);
    await xiaoyinsi.execute?.(request, new AbortController().signal);

    expect(mocks.runLinuxDoAction).toHaveBeenCalledOnce();
    expect(mocks.runLinuxDoAction).toHaveBeenCalledWith(
      expect.objectContaining({
        userAgent: 'test-agent'
      })
    );
    expect(mocks.runXiaoyinsiAction).toHaveBeenCalledOnce();
    expect(linuxdo.csrfSource).toBe('session-endpoint');
    expect(xiaoyinsi.csrfSource).toBe('none');
  });

  it('treats a Xiaoyinsi action as stale after its credential generation changes', async () => {
    let generation = 11;
    mocks.currentXiaoyinsiCredentialGeneration.mockImplementation(() => generation);
    const context = runtimeContext();
    const runtime = await prepareDiscourseActionRuntime('xiaoyinsi', context);

    expect(runtime.isCredentialCurrent?.()).toBe(true);
    generation += 1;

    expect(runtime.isCredentialCurrent?.()).toBe(false);
    await expect(runtime.recover({ authorizationCheckRequired: true })).resolves.toMatchObject({
      phase: 'credential',
      stale: true
    });
    expect(context.refreshXiaoyinsiAuthorization).not.toHaveBeenCalled();
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
      phase: 'credential'
    });
    expect(context.updateLinuxDoSession).not.toHaveBeenCalled();
    expect(context.resetLinuxDoLevelState).not.toHaveBeenCalled();
  });
});
