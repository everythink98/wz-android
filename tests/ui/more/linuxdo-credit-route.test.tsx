import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup } from '@testing-library/react-native';
import { Text } from 'react-native';
import { LinuxDoCreditError } from '@/domain/forum/linuxDoCredit';
import { createSiteSessionStates, type SessionSite } from '@/domain/session/siteSessionState';
import { LinuxDoCreditRoute } from '@/features/more/LinuxDoCreditRoute';
import type { LinuxDoCreditGateway } from '@/features/more/useLinuxDoCredit';
import { LinuxDoCloudflareError } from '@/platform/network/cloudflareChallenge';
import { createAppQueryClient } from '@/platform/query/serverState';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { projectTestAccountSessions, testAccountUser } from '../../helpers/accountSessions';
import { fireEvent, render, waitFor } from '../render';

jest.mock('@/features/more/MoreRouteRuntime', () => ({
  useMoreRouteRuntime: () => mockRuntime
}));

const Stack = createNativeStackNavigator<RootStackParamList>();
const clients: ReturnType<typeof createAppQueryClient>[] = [];

function createRuntime(userId = '42', enabledSessionSources: SessionSite[] = ['linuxdo']) {
  const getLinuxDoCreditAccount = jest.fn<LinuxDoCreditGateway['getLinuxDoCreditAccount']>().mockResolvedValue({
    userId: '42',
    username: 'reader',
    availableBalance: '1234.56',
    pendingBalance: '0'
  });
  const getLinuxDoCreditTransactions = jest
    .fn<LinuxDoCreditGateway['getLinuxDoCreditTransactions']>()
    .mockResolvedValue({
      userId: '42',
      entries: [],
      page: 1,
      total: 0,
      nextPage: null
    });
  const gateway: LinuxDoCreditGateway = {
    getReadPlan: () => ({
      state: 'ready',
      lane: 'authenticated',
      transport: 'managed-session',
      cacheScope: 'authenticated:0'
    }),
    getLinuxDoCreditAccount,
    getLinuxDoCreditTransactions
  };
  return {
    account: {
      active: true,
      enabledSessionSources,
      read: {
        gateway,
        sessionEpochs: initialForumSessionEpochs,
        sessions: projectTestAccountSessions(
          createSiteSessionStates({
            linuxdo: {
              site: 'linuxdo',
              status: 'logged-in',
              cookieSummary: [],
              isVerifying: false,
              currentUser: { ...testAccountUser('linuxdo'), id: userId, username: 'reader' }
            }
          })
        )
      },
      center: {
        command: jest.fn(async () => undefined),
        linuxDoCredit: {
          open: jest.fn(async () => undefined),
          connectSilently: jest.fn(async () => undefined),
          busy: false
        }
      }
    }
  };
}

let mockRuntime = createRuntime();

beforeEach(() => {
  jest.useFakeTimers();
  mockRuntime = createRuntime();
});

afterEach(async () => {
  await cleanup();
  for (const client of clients.splice(0)) client.clear();
  jest.useRealTimers();
});

async function openRoute() {
  const navigation = createNavigationContainerRef<RootStackParamList>();
  const client = createAppQueryClient();
  clients.push(client);
  const view = await render(
    <QueryClientProvider client={client}>
      <NavigationContainer
        ref={navigation}
        initialState={{
          index: 1,
          routes: [
            { name: 'MainTabs' },
            { name: 'LinuxDoCredit', params: { identityKey: 'linuxdo:42', userId: '42', username: 'reader' } }
          ]
        }}
      >
        <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
          <Stack.Screen name="MainTabs">{() => <Text>账号中心入口</Text>}</Stack.Screen>
          <Stack.Screen name="LinuxDoCredit" component={LinuxDoCreditRoute} />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>
  );
  return { view, navigation };
}

describe('LDC route access gates', () => {
  it('blocks a disabled source before either LDC request and returns to content source management', async () => {
    mockRuntime = createRuntime('42', []);
    const { view, navigation } = await openRoute();
    expect(view.getByText('linux.do已停用')).toBeTruthy();
    expect(mockRuntime.account.read.gateway.getLinuxDoCreditAccount).not.toHaveBeenCalled();
    expect(mockRuntime.account.read.gateway.getLinuxDoCreditTransactions).not.toHaveBeenCalled();
    expect(mockRuntime.account.center.linuxDoCredit.connectSilently).not.toHaveBeenCalled();
    await fireEvent.press(view.getByRole('button', { name: '管理内容源' }));
    expect(navigation.getCurrentRoute()).toMatchObject({
      name: 'MainTabs',
      params: { screen: 'more', params: { intent: 'manage-content-sources' } }
    });
  });

  it('refuses a route owned by a different account and offers a return without requesting data', async () => {
    mockRuntime = createRuntime('43');
    const { view, navigation } = await openRoute();
    expect(view.getByText('账号已变化或暂不可用，请返回账号中心')).toBeTruthy();
    expect(mockRuntime.account.read.gateway.getLinuxDoCreditAccount).not.toHaveBeenCalled();
    expect(mockRuntime.account.read.gateway.getLinuxDoCreditTransactions).not.toHaveBeenCalled();
    await fireEvent.press(view.getByRole('button', { name: '返回账号中心' }));
    expect(navigation.getCurrentRoute()?.name).toBe('MainTabs');
  });

  it('reads the focused matching account and its records through the real controller', async () => {
    const { view } = await openRoute();
    await waitFor(() => expect(view.getByText('1,234.56')).toBeTruthy());
    await waitFor(() => expect(view.getByText('暂无收支记录')).toBeTruthy());
    expect(mockRuntime.account.read.gateway.getLinuxDoCreditAccount).toHaveBeenCalledTimes(1);
    expect(mockRuntime.account.read.gateway.getLinuxDoCreditAccount).toHaveBeenCalledWith(
      expect.objectContaining({ userId: '42', username: 'reader' }),
      { readPlanScope: 'authenticated:0' }
    );
    expect(mockRuntime.account.read.gateway.getLinuxDoCreditTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ userId: '42', username: 'reader', page: 1 }),
      { readPlanScope: 'authenticated:0' }
    );
    expect(mockRuntime.account.center.linuxDoCredit.open).not.toHaveBeenCalled();
  });

  it('tries silent LDC connection before offering the explicit Account authorization action', async () => {
    jest
      .mocked(mockRuntime.account.read.gateway.getLinuxDoCreditAccount)
      .mockRejectedValue(new LinuxDoCreditError('authorization-required', '请先连接 LDC'));
    const { view } = await openRoute();
    await waitFor(() => expect(view.getByText('请先连接 LDC')).toBeTruthy());
    expect(mockRuntime.account.center.linuxDoCredit.connectSilently).toHaveBeenCalledTimes(1);
    expect(mockRuntime.account.read.gateway.getLinuxDoCreditTransactions).not.toHaveBeenCalled();
    expect(mockRuntime.account.center.linuxDoCredit.open).not.toHaveBeenCalled();
    await fireEvent.press(view.getByRole('button', { name: '连接 LDC' }));
    expect(mockRuntime.account.center.linuxDoCredit.open).toHaveBeenCalledTimes(1);
  });

  it('delegates a forum verification challenge to the forum login instead of the LDC website', async () => {
    jest
      .mocked(mockRuntime.account.read.gateway.getLinuxDoCreditAccount)
      .mockRejectedValue(new LinuxDoCloudflareError());
    const { view } = await openRoute();
    await waitFor(() => expect(view.getByRole('button', { name: '验证 L 站' })).toBeTruthy());
    expect(mockRuntime.account.center.linuxDoCredit.connectSilently).not.toHaveBeenCalled();
    expect(mockRuntime.account.read.gateway.getLinuxDoCreditTransactions).not.toHaveBeenCalled();
    expect(mockRuntime.account.center.command).not.toHaveBeenCalled();
    await fireEvent.press(view.getByRole('button', { name: '验证 L 站' }));
    expect(mockRuntime.account.center.command).toHaveBeenCalledTimes(1);
    expect(mockRuntime.account.center.command).toHaveBeenCalledWith({ type: 'open-login', site: 'linuxdo' });
    expect(mockRuntime.account.center.linuxDoCredit.open).not.toHaveBeenCalled();
  });
});
