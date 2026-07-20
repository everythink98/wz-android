import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearExpiredLinuxDoLogin: vi.fn(async () => undefined),
  currentXiaoyinsiCredentialGeneration: vi.fn(() => 11),
  loadLinuxDoAccess: vi.fn(),
  loadXiaoyinsiCredentials: vi.fn(),
  runLinuxDoAction: vi.fn(async () => ({ ok: true })),
  runXiaoyinsiAction: vi.fn(async () => ({ ok: true }))
}));

vi.mock('../linuxdoActionClient', () => ({ runLinuxDoAction: mocks.runLinuxDoAction }));
vi.mock('../linuxdoCookieBridge', () => ({
  currentLinuxDoAccessGeneration: () => 7,
  linuxDoAccessSummary: () => ({ loggedIn: true }),
  loadLinuxDoAccess: mocks.loadLinuxDoAccess
}));
vi.mock('../xiaoyinsiActionClient', () => ({ runXiaoyinsiAction: mocks.runXiaoyinsiAction }));
vi.mock('../xiaoyinsiAuth', () => ({
  currentXiaoyinsiCredentialGeneration: mocks.currentXiaoyinsiCredentialGeneration,
  loadXiaoyinsiCredentials: mocks.loadXiaoyinsiCredentials
}));
vi.mock('./topicActionHelpers', () => ({ clearExpiredLinuxDoLogin: mocks.clearExpiredLinuxDoLogin }));

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
  mocks.loadLinuxDoAccess.mockResolvedValue({ cookieHeader: 'sid=test', userAgent: 'saved-agent' });
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
});
