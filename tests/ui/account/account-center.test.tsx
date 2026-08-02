import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '../render';
import React from 'react';
import { Alert } from 'react-native';
import { CredentialVaultError, emptyCredentialSummaries } from '@/platform/storage/credentialVault';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { AccountCenterPanel } from '@/features/more/components/AccountCenterPanel';
import type { AccountCenterCommand } from '@/domain/session/accountCenter';
import { createSiteSessionStates, createSiteSessionViewModels } from '@/domain/session/siteSessionState';
import { createTheme } from '@/ui/theme/tokens';
import { createTestStyles as createStyles } from '../styleFixture';

jest.mock('lucide-react-native', () => ({
  ChevronDown: () => null,
  ChevronRight: () => null,
  ChevronUp: () => null,
  RefreshCw: () => null,
  User: () => null
}));

const readerData = createEmptyReaderData();
const theme = createTheme(readerData.settings);
const styles = createStyles(theme, readerData.settings, 800);
const sessions = createSiteSessionViewModels(createSiteSessionStates());

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Account center user authentication', () => {
  it('routes each site status to the matching account action', async () => {
    const currentUser = {
      source: 'nodeseek' as const,
      id: '42',
      username: 'alice',
      displayName: 'Alice',
      url: 'https://www.nodeseek.com/space/42',
      topics: []
    };
    const mixedSessions = createSiteSessionViewModels(
      createSiteSessionStates({
        nodeseek: {
          site: 'nodeseek',
          status: 'logged-in',
          cookieSummary: ['session'],
          currentUser,
          isVerifying: false
        },
        linuxdo: {
          site: 'linuxdo',
          status: 'verification-required',
          cookieSummary: [],
          isVerifying: false,
          lastError: '需要完成验证'
        },
        yaohuo: {
          site: 'yaohuo',
          status: 'expired',
          cookieSummary: ['sid'],
          isVerifying: false
        }
      })
    );
    const credentials = emptyCredentialSummaries();
    credentials.yaohuo = {
      site: 'yaohuo',
      state: 'saved',
      hasCredential: true,
      protection: 'device'
    };
    const onCommand = jest.fn(async (_command: AccountCenterCommand) => undefined);
    const view = await render(
      <AccountCenterPanel
        credentials={credentials}
        expanded
        nodeSeekUserId={42}
        sessions={mixedSessions}
        siteContent={{}}
        statusBusy={false}
        styles={styles}
        theme={theme}
        onCommand={onCommand}
        onExpandedChange={jest.fn()}
      />
    );

    expect(view.getByText('待处理 2 · 网站登录 1/4 · 自动填入 1/3')).toBeTruthy();
    expect(view.getByText('Alice · 已登录')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('查看主页'));
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'open-user', user: currentUser });

    await fireEvent.press(view.getByTestId('account-site-linuxdo'));
    expect(view.getByText('需要完成验证')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('去验证'));
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'open-login', site: 'linuxdo' });

    await fireEvent.press(view.getByTestId('account-site-yaohuo'));
    expect(view.getByText('已失效')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('重新登录并填入'));
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'open-login-with-fill', site: 'yaohuo' });
  });

  it('uses the canonical label and explains the confirmed device-encryption fallback', async () => {
    const credentials = emptyCredentialSummaries();
    credentials.nodeseek = {
      site: 'nodeseek',
      state: 'saved',
      hasCredential: true,
      protection: 'biometric'
    };
    const onCommand = jest.fn(async (command: AccountCenterCommand) => {
      if (command.type === 'save-credential' && !command.allowUnprotected) {
        throw new CredentialVaultError(
          'biometric-unavailable',
          '当前设备无法使用用户身份认证，请确认后再使用本机加密保存'
        );
      }
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const view = await render(
      <AccountCenterPanel
        credentials={credentials}
        expanded
        nodeSeekUserId={null}
        sessions={sessions}
        siteContent={{}}
        statusBusy={false}
        styles={styles}
        theme={theme}
        onCommand={onCommand}
        onExpandedChange={jest.fn()}
      />
    );

    expect(view.getByText('已设置 · 用户身份认证')).toBeTruthy();
    await fireEvent.press(view.getByText('管理'));
    await fireEvent.changeText(view.getByLabelText('NodeSeek 登录账号'), 'local-account');
    await fireEvent.changeText(view.getByLabelText('NodeSeek 登录密码'), 'local-password');
    await fireEvent.press(view.getByLabelText('保存'));

    await waitFor(() => {
      expect(alert).toHaveBeenCalledWith(
        '无法使用用户身份认证',
        '继续后将使用 Android 本机加密保存，但填入时不会再次进行用户身份认证。',
        expect.any(Array)
      );
    });

    const buttons = alert.mock.calls[0]?.[2];
    buttons?.find((button) => button.text === '取消')?.onPress?.();
    expect(onCommand).toHaveBeenCalledTimes(1);

    await act(async () => {
      buttons?.find((button) => button.text === '继续保存')?.onPress?.();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await waitFor(() => {
      expect(onCommand).toHaveBeenCalledWith({
        type: 'save-credential',
        site: 'nodeseek',
        account: 'local-account',
        password: 'local-password',
        allowUnprotected: true
      });
    });
  });

  it('disables account refresh while a status refresh is already running', async () => {
    const onCommand = jest.fn(async (_command: AccountCenterCommand) => undefined);
    const view = await render(
      <AccountCenterPanel
        credentials={emptyCredentialSummaries()}
        expanded
        nodeSeekUserId={null}
        sessions={sessions}
        siteContent={{}}
        statusBusy
        styles={styles}
        theme={theme}
        onCommand={onCommand}
        onExpandedChange={jest.fn()}
      />
    );

    expect(view.getByLabelText('刷新中').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByLabelText('刷新中'));
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('deletes saved credentials only after destructive confirmation', async () => {
    const credentials = emptyCredentialSummaries();
    credentials.nodeseek = {
      site: 'nodeseek',
      state: 'saved',
      hasCredential: true,
      protection: 'biometric'
    };
    const onCommand = jest.fn(async (_command: AccountCenterCommand) => undefined);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const view = await render(
      <AccountCenterPanel
        credentials={credentials}
        expanded
        nodeSeekUserId={null}
        sessions={sessions}
        siteContent={{}}
        statusBusy={false}
        styles={styles}
        theme={theme}
        onCommand={onCommand}
        onExpandedChange={jest.fn()}
      />
    );

    await fireEvent.press(view.getByText('管理'));
    await fireEvent.press(view.getByLabelText('删除'));
    expect(alert).toHaveBeenCalledWith(
      '删除已保存登录信息？',
      '只删除保存的账号密码，不会退出当前网站登录。',
      expect.any(Array)
    );
    expect(onCommand).not.toHaveBeenCalled();

    const buttons = alert.mock.calls[0]?.[2];
    buttons?.find((button) => button.text === '取消')?.onPress?.();
    expect(onCommand).not.toHaveBeenCalled();
    await act(async () => {
      buttons?.find((button) => button.text === '删除')?.onPress?.();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(onCommand).toHaveBeenCalledWith({ type: 'delete-credential', site: 'nodeseek' });
    });
  });
});
