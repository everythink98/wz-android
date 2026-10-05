import { projectTestAccountSessions, testAccountUser } from '../../helpers/accountSessions';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '../render';
import { Alert, DeviceEventEmitter, Platform, Text } from 'react-native';
import { Profiler } from 'react';
import { CredentialVaultError, emptyCredentialSummaries } from '@/platform/storage/credentialVault';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { AccountCenterPanel } from '@/features/more/components/AccountCenterPanel';
import type { AccountCenterCommand } from '@/domain/session/accountCenter';
import { createSiteSessionStates } from '@/domain/session/siteSessionState';
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
const sessions = projectTestAccountSessions(createSiteSessionStates());
const allSessionSources = ['nodeseek', 'linuxdo', 'yaohuo'] as const;

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Account center user authentication', () => {
  it('reuses the account card when switching cached content without fading it', async () => {
    const view = await render(
      <AccountCenterPanel
        credentials={emptyCredentialSummaries()}
        enabledSessionSources={allSessionSources}
        expanded
        nodeSeekUserId={null}
        sessions={sessions}
        siteContent={{
          nodeseek: <Text>NS 账号内容</Text>,
          linuxdo: <Text>L 账号内容</Text>,
          yaohuo: <Text>妖火账号内容</Text>
        }}
        statusBusy={false}
        styles={styles}
        theme={theme}
        onCommand={jest.fn<() => void>()}
        onExpandedChange={jest.fn()}
      />
    );
    const card = view.getByText('NS 账号内容').parent?.parent?.parent;
    expect(card).toBeTruthy();
    for (const [site, label] of [
      ['linuxdo', 'L 账号内容'],
      ['yaohuo', '妖火账号内容'],
      ['nodeseek', 'NS 账号内容']
    ]) {
      await fireEvent.press(view.getByTestId(`account-site-${site}`));
      expect(view.getByText(label).parent?.parent?.parent).toBe(card);
      for (let node = view.getByText(label).parent; node; node = node.parent) {
        expect(node.props.entering).toBeUndefined();
      }
    }
  });

  it('creates site settings only when opened and keeps their collapse subtree within the same owner', async () => {
    const settingsRender = jest.fn(() => <Text>NS 低频设置</Text>);
    const view = await render(
      <AccountCenterPanel
        credentials={emptyCredentialSummaries()}
        enabledSessionSources={allSessionSources}
        expanded
        nodeSeekUserId={null}
        sessions={sessions}
        siteContent={{}}
        siteSettings={{ nodeseek: settingsRender }}
        statusBusy={false}
        styles={styles}
        theme={theme}
        onCommand={jest.fn<() => void>()}
        onExpandedChange={jest.fn()}
      />
    );

    expect(settingsRender).not.toHaveBeenCalled();
    expect(view.queryByText('自动填入', { includeHiddenElements: true })).toBeNull();
    await fireEvent.press(view.getByLabelText('站点设置'));
    const settingsContent = view.getByText('NS 低频设置');
    expect(view.getByText('自动填入')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('收起站点设置'));
    expect(view.queryByText('NS 低频设置')).toBeNull();
    expect(view.getByText('NS 低频设置', { includeHiddenElements: true })).toBe(settingsContent);

    await fireEvent.press(view.getByTestId('account-site-linuxdo'));
    expect(view.queryByText('自动填入', { includeHiddenElements: true })).toBeNull();
    expect(view.queryByText('NS 低频设置', { includeHiddenElements: true })).toBeNull();
    const rendersBeforeReturn = settingsRender.mock.calls.length;
    await fireEvent.press(view.getByTestId('account-site-nodeseek'));
    expect(settingsRender).toHaveBeenCalledTimes(rendersBeforeReturn);
    expect(view.queryByText('自动填入', { includeHiddenElements: true })).toBeNull();
    await fireEvent.press(view.getByLabelText('站点设置'));
    expect(view.getByText('NS 低频设置')).toBeTruthy();
  });

  it('clears credential drafts across source and user changes while retaining the account card', async () => {
    const accountSessions = (id: string) =>
      projectTestAccountSessions(
        createSiteSessionStates({
          nodeseek: {
            site: 'nodeseek',
            status: 'logged-in',
            cookieSummary: [],
            isVerifying: false,
            currentUser: { ...testAccountUser('nodeseek'), id }
          }
        })
      );
    const panel = (id: string) => (
      <AccountCenterPanel
        credentials={emptyCredentialSummaries()}
        enabledSessionSources={allSessionSources}
        expanded
        nodeSeekUserId={Number(id)}
        sessions={accountSessions(id)}
        siteContent={{ nodeseek: <Text>NS 账号内容</Text> }}
        statusBusy={false}
        styles={styles}
        theme={theme}
        onCommand={jest.fn<() => void>()}
        onExpandedChange={jest.fn()}
      />
    );
    const view = await render(panel('123'));
    await fireEvent.press(view.getByLabelText('站点设置'));
    await fireEvent.press(view.getByText('设置'));
    await fireEvent.changeText(view.getByLabelText('NodeSeek 登录账号'), 'local-account');
    await fireEvent.changeText(view.getByLabelText('NodeSeek 登录密码'), 'local-password');
    await fireEvent.press(view.getByTestId('account-site-linuxdo'));
    expect(view.queryByLabelText('NodeSeek 登录密码', { includeHiddenElements: true })).toBeNull();
    await fireEvent.press(view.getByTestId('account-site-nodeseek'));
    await fireEvent.press(view.getByLabelText('站点设置'));
    await fireEvent.press(view.getByText('设置'));
    expect(view.getByLabelText('NodeSeek 登录账号').props.value).toBe('');
    expect(view.getByLabelText('NodeSeek 登录密码').props.value).toBe('');
    await fireEvent.changeText(view.getByLabelText('NodeSeek 登录密码'), 'another-draft');
    await view.rerender(panel('456'));
    expect(view.queryByLabelText('NodeSeek 登录密码', { includeHiddenElements: true })).toBeNull();
    await fireEvent.press(view.getByLabelText('站点设置'));
    await fireEvent.press(view.getByText('设置'));
    expect(view.getByLabelText('NodeSeek 登录账号').props.value).toBe('');
    expect(view.getByLabelText('NodeSeek 登录密码').props.value).toBe('');
  });

  it('preserves credential drafts across Android keyboard cycles and clears them when the editor is cancelled', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'android');
    const onCommand = jest.fn<() => void>();
    try {
      const view = await render(
        <AccountCenterPanel
          credentials={emptyCredentialSummaries()}
          enabledSessionSources={allSessionSources}
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
      await fireEvent.press(view.getByLabelText('站点设置'));
      await fireEvent.press(view.getByText('设置'));
      for (let cycle = 0; cycle < 2; cycle += 1) {
        await act(() =>
          DeviceEventEmitter.emit('keyboardDidShow', {
            duration: 250,
            easing: 'keyboard',
            endCoordinates: { height: 300, width: 400, screenX: 0, screenY: 500 }
          })
        );
        await fireEvent.changeText(view.getByLabelText('NodeSeek 登录账号'), `draft-account-${cycle}`);
        await fireEvent.changeText(view.getByLabelText('NodeSeek 登录密码'), `draft-password-${cycle}`);
        await act(() => DeviceEventEmitter.emit('keyboardDidHide', {}));
        expect(view.getByLabelText('NodeSeek 登录账号').props.value).toBe(`draft-account-${cycle}`);
        expect(view.getByLabelText('NodeSeek 登录密码').props.value).toBe(`draft-password-${cycle}`);
        expect(view.getByLabelText('NodeSeek 登录密码').props.secureTextEntry).toBe(true);
      }

      await fireEvent.press(view.getByLabelText('取消'));
      expect(view.queryByLabelText('NodeSeek 登录密码')).toBeNull();
      await fireEvent.press(view.getByText('设置'));
      expect(view.getByLabelText('NodeSeek 登录账号').props.value).toBe('');
      expect(view.getByLabelText('NodeSeek 登录密码').props.value).toBe('');
      expect(view.getByLabelText('保存').props.accessibilityState.disabled).toBe(true);
      expect(onCommand).not.toHaveBeenCalled();
    } finally {
      await act(() => DeviceEventEmitter.emit('keyboardDidHide', {}));
      platform.restore();
    }
  });

  it('commits a controlled site change once without echoing the selection', async () => {
    const commits = jest.fn();
    const selectionChanges = jest.fn();
    const common = {
      credentials: emptyCredentialSummaries(),
      enabledSessionSources: allSessionSources,
      expanded: true,
      nodeSeekUserId: null,
      sessions,
      siteContent: {},
      statusBusy: false,
      styles,
      theme,
      onCommand: jest.fn<() => void>(),
      onExpandedChange: jest.fn(),
      onSelectedSiteChange: selectionChanges
    };
    const panel = (site: (typeof allSessionSources)[number]) => (
      <Profiler id="account" onRender={commits}>
        <AccountCenterPanel {...common} selectedSite={site} />
      </Profiler>
    );
    const view = await render(panel('nodeseek'));
    commits.mockClear();
    for (const site of ['linuxdo', 'yaohuo', 'nodeseek'] as const) {
      await view.rerender(panel(site));
      expect(view.getByTestId(`account-site-${site}`).props.accessibilityState.selected).toBe(true);
    }
    expect(commits).toHaveBeenCalledTimes(3);
    expect(selectionChanges).not.toHaveBeenCalled();
    await fireEvent.press(view.getByTestId('account-site-nodeseek'));
    expect(commits).toHaveBeenCalledTimes(3);
    expect(selectionChanges).not.toHaveBeenCalled();
  });

  it('renders only enabled account sites in user order and fails closed for disabled forced or pending sites', async () => {
    const disabledLinuxContentRender = jest.fn();
    const DisabledLinuxContent = () => {
      disabledLinuxContentRender();
      return <Text>linux.do 专属内容</Text>;
    };
    const view = await render(
      <AccountCenterPanel
        key="forced-disabled"
        credentials={emptyCredentialSummaries()}
        enabledSessionSources={['yaohuo', 'nodeseek']}
        expanded
        forcedSite="linuxdo"
        nodeSeekUserId={null}
        sessions={sessions}
        siteContent={{
          linuxdo: <DisabledLinuxContent />,
          yaohuo: <Text>妖火专属内容</Text>
        }}
        statusBusy={false}
        styles={styles}
        theme={theme}
        onCommand={jest.fn(async (_command: AccountCenterCommand) => undefined)}
        onExpandedChange={jest.fn()}
      />
    );

    expect(view.getAllByRole('tab').map((tab) => tab.props.testID)).toEqual([
      'account-site-yaohuo',
      'account-site-nodeseek'
    ]);
    expect(view.getByTestId('account-site-yaohuo').props.accessibilityState.selected).toBe(true);
    expect(view.getByText('妖火专属内容')).toBeTruthy();
    expect(view.queryByText('linux.do 专属内容')).toBeNull();
    expect(disabledLinuxContentRender).not.toHaveBeenCalled();

    await view.rerender(
      <AccountCenterPanel
        key="pending-disabled"
        credentials={emptyCredentialSummaries()}
        enabledSessionSources={['yaohuo', 'nodeseek']}
        expanded
        pendingFillSite="linuxdo"
        nodeSeekUserId={null}
        sessions={sessions}
        siteContent={{ yaohuo: <Text>妖火专属内容</Text> }}
        statusBusy={false}
        styles={styles}
        theme={theme}
        onCommand={jest.fn(async (_command: AccountCenterCommand) => undefined)}
        onExpandedChange={jest.fn()}
      />
    );
    expect(view.getByTestId('account-site-yaohuo').props.accessibilityState.selected).toBe(true);
  });

  it('falls back to the first enabled site when the selected site is disabled', async () => {
    const common = {
      credentials: emptyCredentialSummaries(),
      expanded: true,
      nodeSeekUserId: null,
      sessions,
      siteContent: {},
      statusBusy: false,
      styles,
      theme,
      onCommand: jest.fn(async (_command: AccountCenterCommand) => undefined),
      onExpandedChange: jest.fn()
    };
    const view = await render(<AccountCenterPanel {...common} enabledSessionSources={['nodeseek', 'linuxdo']} />);
    await fireEvent.press(view.getByTestId('account-site-linuxdo'));
    expect(view.getByTestId('account-site-linuxdo').props.accessibilityState.selected).toBe(true);

    await view.rerender(<AccountCenterPanel {...common} enabledSessionSources={['yaohuo', 'nodeseek']} />);
    expect(view.getByTestId('account-site-yaohuo').props.accessibilityState.selected).toBe(true);
    expect(view.queryByTestId('account-site-linuxdo')).toBeNull();
  });

  it('keeps open site settings when the selected site is tapped again', async () => {
    const onSelectedSiteChange = jest.fn();
    const view = await render(
      <AccountCenterPanel
        credentials={emptyCredentialSummaries()}
        enabledSessionSources={allSessionSources}
        expanded
        nodeSeekUserId={null}
        sessions={sessions}
        siteContent={{}}
        statusBusy={false}
        styles={styles}
        theme={theme}
        onCommand={jest.fn(async (_command: AccountCenterCommand) => undefined)}
        onExpandedChange={jest.fn()}
        onSelectedSiteChange={onSelectedSiteChange}
      />
    );
    await fireEvent.press(view.getByLabelText('站点设置'));
    expect(view.getByLabelText('收起站点设置').props.accessibilityState.expanded).toBe(true);
    await fireEvent.press(view.getByTestId('account-site-nodeseek'));
    expect(view.getByLabelText('收起站点设置').props.accessibilityState.expanded).toBe(true);
    expect(onSelectedSiteChange).not.toHaveBeenCalled();

    await fireEvent.press(view.getByTestId('account-site-linuxdo'));
    expect(view.getByLabelText('站点设置').props.accessibilityState.expanded).toBe(false);
    expect(onSelectedSiteChange).toHaveBeenCalledTimes(1);
    expect(onSelectedSiteChange).toHaveBeenLastCalledWith('linuxdo');
  });

  it('shows stable management guidance for an empty enabled account set', async () => {
    const onCommand = jest.fn(async (_command: AccountCenterCommand) => undefined);
    const view = await render(
      <AccountCenterPanel
        credentials={emptyCredentialSummaries()}
        enabledSessionSources={[]}
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

    expect(view.getByText('尚未启用账号站点')).toBeTruthy();
    expect(view.getByText('请在“内容源”面板启用支持账号的站点。')).toBeTruthy();
    expect(view.queryAllByRole('tab')).toHaveLength(0);
    expect(view.queryByLabelText('刷新账号')).toBeNull();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('routes each site status to the matching account action', async () => {
    const currentUser = {
      source: 'nodeseek' as const,
      id: '42',
      username: 'alice',
      displayName: 'Alice',
      levelLabel: 'Lv2',
      url: 'https://www.nodeseek.com/space/42',
      topics: []
    };
    const mixedSessions = projectTestAccountSessions(
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
        enabledSessionSources={allSessionSources}
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

    expect(view.getByText('待处理 2 · 已登录 1/3')).toBeTruthy();
    expect(view.getAllByText('Alice')).toHaveLength(1);
    expect(view.getByText('已登录 · Lv2')).toBeTruthy();
    expect(view.queryByText('站点')).toBeNull();
    expect(view.queryByText('刷新账号')).toBeNull();
    expect(view.getByLabelText('刷新账号')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('查看主页'));
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'open-user', user: currentUser });

    await fireEvent.press(view.getByTestId('account-site-linuxdo'));
    expect(view.getByText('本次核对失败，可重试')).toBeTruthy();
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
        enabledSessionSources={allSessionSources}
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

    expect(view.queryByText('已设置 · 用户身份认证')).toBeNull();
    await fireEvent.press(view.getByLabelText('站点设置'));
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
        enabledSessionSources={allSessionSources}
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
        enabledSessionSources={allSessionSources}
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

    await fireEvent.press(view.getByLabelText('站点设置'));
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
