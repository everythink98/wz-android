import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useCallback: <T>(callback: T) => callback,
  useEffect: () => undefined,
  useRef: <T>(value: T) => ({ current: value }),
  useState: <T>(initial: T) => [initial, vi.fn()]
}));

const mocks = vi.hoisted(() => ({
  delete: vi.fn(),
  getSummary: vi.fn(),
  readForFill: vi.fn(),
  save: vi.fn()
}));

vi.mock('@/platform/storage/credentialVault', () => ({
  CredentialVaultError: class CredentialVaultError extends Error {},
  credentialVault: mocks,
  emptyCredentialSummaries: {
    nodeseek: { site: 'nodeseek', state: 'missing', hasCredential: false, protection: null },
    linuxdo: { site: 'linuxdo', state: 'missing', hasCredential: false, protection: null },
    yaohuo: { site: 'yaohuo', state: 'missing', hasCredential: false, protection: null }
  }
}));

import { LOGIN_FORM_ADAPTERS } from '@/loginFormAdapters';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { useAccountCredentialController } from './useAccountCredentialController';

function createController(overrides: Partial<Parameters<typeof useAccountCredentialController>[0]> = {}) {
  const notify = vi.fn();
  const controller = useAccountCredentialController({
    changeLinuxDoPanel: vi.fn(() => true),
    changeNodeSeekLoginPanel: vi.fn(),
    changeScreen: vi.fn(),
    changeYaohuoLoginPanel: vi.fn(),
    linuxDoWebViewRef: { current: null },
    notify,
    onOpenXiaoyinsiAuthorization: vi.fn(),
    openUser: vi.fn(async () => undefined),
    refreshAccountStatus: vi.fn(async () => undefined),
    setYaohuoLoginPrompt: vi.fn(),
    webViewRef: { current: null },
    webViewBlockMessage: '',
    yaohuoWebViewRef: { current: null },
    ...overrides
  });
  return { controller, notify };
}

afterEach(() => {
  setDiagnosticWriter(null);
  vi.clearAllMocks();
});

describe('account credential controller ownership', () => {
  it('does not resume automatic fill after its WebView attempt fails', async () => {
    const { controller } = createController();
    controller.openAccountLogin('nodeseek', true);

    controller.finishCredentialFillForLoginFailure('nodeseek', 1, 'timeout');
    const handled = controller.handleCredentialLoginFormMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'login-form-probe',
          site: 'nodeseek',
          attempt: 1,
          ok: true,
          url: LOGIN_FORM_ADAPTERS.nodeseek.loginUrl
        }),
        url: LOGIN_FORM_ADAPTERS.nodeseek.loginUrl
      }
    } as never);
    await Promise.resolve();

    expect(handled).toBe(true);
    expect(mocks.readForFill).not.toHaveBeenCalled();
  });

  it('ignores a failure from an older attempt of the same site', () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const { controller } = createController();
    controller.openAccountLogin('nodeseek', true);
    controller.openAccountLogin('nodeseek', true);

    controller.finishCredentialFillForLoginFailure('nodeseek', 1, 'timeout');

    const finishes = lines
      .map((line) => JSON.parse(line) as { operation?: string; phase?: string; outcome?: string })
      .filter((event) => event.operation === 'load' && event.phase === 'finish');
    expect(finishes).toEqual([expect.objectContaining({ outcome: 'stale' })]);
  });

  it('ignores a form probe from an older attempt of the same site', async () => {
    mocks.readForFill.mockResolvedValue({
      site: 'nodeseek',
      account: 'private-account',
      password: 'private-password',
      updatedAt: 1
    });
    const { controller } = createController();
    controller.openAccountLogin('nodeseek', true);
    controller.openAccountLogin('nodeseek', true);

    controller.handleCredentialLoginFormMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'login-form-probe',
          site: 'nodeseek',
          attempt: 1,
          ok: true,
          url: LOGIN_FORM_ADAPTERS.nodeseek.loginUrl
        }),
        url: LOGIN_FORM_ADAPTERS.nodeseek.loginUrl
      }
    } as never);
    await Promise.resolve();

    expect(mocks.readForFill).not.toHaveBeenCalled();
  });

  it('does not start a fill trace when linux.do rejects opening during close', () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const { controller } = createController({ changeLinuxDoPanel: vi.fn(() => false) });

    controller.openAccountLogin('linuxdo', true);

    expect(lines.map((line) => JSON.parse(line) as { operation?: string })).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ operation: 'load' })])
    );
  });

  it('finishes automatic fill immediately when WebViews are blocked', () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const { controller } = createController({ webViewBlockMessage: 'WebView unavailable' });

    controller.openAccountLogin('nodeseek', true);

    expect(lines.map((line) => JSON.parse(line) as { operation?: string; phase?: string; outcome?: string })).toEqual(
      expect.arrayContaining([expect.objectContaining({ operation: 'load', phase: 'finish', outcome: 'blocked' })])
    );
  });

  it('does not let a later summary reload suppress a completed save', async () => {
    let resolveSave!: (value: {
      site: 'nodeseek';
      state: 'saved';
      hasCredential: true;
      protection: 'biometric';
    }) => void;
    mocks.save.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      })
    );
    mocks.getSummary.mockImplementation(async (site: 'nodeseek' | 'linuxdo' | 'yaohuo') => ({
      site,
      state: 'missing',
      hasCredential: false,
      protection: null
    }));
    const { controller, notify } = createController();

    const save = controller.handleAccountCenterCommand({
      type: 'save-credential',
      site: 'nodeseek',
      account: 'private-account',
      password: 'private-password'
    });
    await controller.reloadCredentialSummaries();
    resolveSave({
      site: 'nodeseek',
      state: 'saved',
      hasCredential: true,
      protection: 'biometric'
    });
    await save;

    expect(notify).toHaveBeenCalledWith('登录信息已安全保存。');
  });

  it('records summary apply before finishing a credential save', async () => {
    mocks.save.mockResolvedValue({
      site: 'nodeseek',
      state: 'saved',
      hasCredential: true,
      protection: 'biometric'
    });
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const { controller } = createController();

    await controller.handleAccountCenterCommand({
      type: 'save-credential',
      site: 'nodeseek',
      account: 'private-account',
      password: 'private-password'
    });

    expect(
      lines
        .map((line) => JSON.parse(line) as { operation?: string; phase?: string })
        .filter((event) => event.operation === 'save')
        .map((event) => event.phase)
    ).toEqual(['intent', 'guard', 'credential', 'persist', 'apply', 'finish']);
  });

  it('records biometric cancellation without account or password text', async () => {
    mocks.save.mockRejectedValue(new Error('User canceled the authentication'));
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const { controller } = createController();

    await expect(
      controller.handleAccountCenterCommand({
        type: 'save-credential',
        site: 'nodeseek',
        account: 'PRIVATE_ACCOUNT_VALUE',
        password: 'PRIVATE_PASSWORD_VALUE'
      })
    ).rejects.toThrow('User canceled');

    const events = lines.map(
      (line) =>
        JSON.parse(line) as {
          operation?: string;
          phase?: string;
          outcome?: string;
          reason?: string;
          isAuthenticationRequired?: boolean;
        }
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'save', phase: 'intent', isAuthenticationRequired: true }),
        expect.objectContaining({ operation: 'save', phase: 'credential', isAuthenticationRequired: true }),
        expect.objectContaining({ operation: 'save', phase: 'finish', outcome: 'canceled', reason: 'canceled' })
      ])
    );
    expect(lines.join('')).not.toMatch(/PRIVATE_ACCOUNT_VALUE|PRIVATE_PASSWORD_VALUE|User canceled/);
  });

  it('drops an older summary reload that finishes after a save', async () => {
    const resolvers: ((value: {
      site: 'nodeseek' | 'linuxdo' | 'yaohuo';
      state: 'missing';
      hasCredential: false;
      protection: null;
    }) => void)[] = [];
    mocks.getSummary.mockImplementation(
      (_site: 'nodeseek' | 'linuxdo' | 'yaohuo') =>
        new Promise((resolve) => {
          resolvers.push((value) => resolve(value));
        })
    );
    mocks.save.mockResolvedValue({
      site: 'nodeseek',
      state: 'saved',
      hasCredential: true,
      protection: 'biometric'
    });
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const { controller } = createController();

    const oldReload = controller.reloadCredentialSummaries();
    await controller.handleAccountCenterCommand({
      type: 'save-credential',
      site: 'nodeseek',
      account: 'private-account',
      password: 'private-password'
    });
    (['nodeseek', 'linuxdo', 'yaohuo'] as const).forEach((site, index) => {
      resolvers[index]?.({ site, state: 'missing', hasCredential: false, protection: null });
    });

    await expect(oldReload).resolves.toBe(false);
    expect(lines.map((line) => JSON.parse(line) as { operation?: string; phase?: string; outcome?: string })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'load-summary', phase: 'finish', outcome: 'stale' })
      ])
    );
  });

  it('drops an older summary reload that finishes after a delete', async () => {
    const resolvers: ((value: {
      site: 'nodeseek' | 'linuxdo' | 'yaohuo';
      state: 'saved';
      hasCredential: true;
      protection: 'biometric';
    }) => void)[] = [];
    mocks.getSummary.mockImplementation(
      (_site: 'nodeseek' | 'linuxdo' | 'yaohuo') =>
        new Promise((resolve) => {
          resolvers.push((value) => resolve(value));
        })
    );
    mocks.delete.mockResolvedValue(undefined);
    const { controller } = createController();

    const oldReload = controller.reloadCredentialSummaries();
    mocks.getSummary.mockImplementation(async (site: 'nodeseek' | 'linuxdo' | 'yaohuo') => ({
      site,
      state: 'missing',
      hasCredential: false,
      protection: null
    }));
    await controller.handleAccountCenterCommand({ type: 'delete-credential', site: 'nodeseek' });
    (['nodeseek', 'linuxdo', 'yaohuo'] as const).forEach((site, index) => {
      resolvers[index]?.({ site, state: 'saved', hasCredential: true, protection: 'biometric' });
    });

    await expect(oldReload).resolves.toBe(false);
  });
});
