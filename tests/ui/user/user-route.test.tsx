import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Linking, Text } from 'react-native';
import { useAppDeepLinkNavigation } from '@/app/useAppDeepLinkNavigation';
import type { Topic, UserProfile } from '@/domain/forum/models';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { createTopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { UserRoute, UserRouteRuntimeProvider, type UserRouteRuntimeValue } from '@/features/user/UserRoute';
import { UserScreen } from '@/features/user/UserScreen';
import { useUserController } from '@/features/user/useUserController';
import { act, fireEvent, render } from '../render';

jest.mock('@/features/user/useUserController');
let mockUseRealUserScreen = false;
jest.mock('@/features/user/UserScreen', () => ({
  UserScreen: jest.fn((props: React.ComponentProps<typeof import('@/features/user/UserScreen').UserScreen>) => {
    if (!mockUseRealUserScreen) return null;
    const { UserScreen } =
      jest.requireActual<typeof import('@/features/user/UserScreen')>('@/features/user/UserScreen');
    return <UserScreen {...props} />;
  })
}));

const profile: UserProfile = {
  source: 'nodeseek',
  id: '23042',
  username: 'recipient',
  displayName: '收件人',
  url: 'https://www.nodeseek.com/space/23042',
  topics: [],
  hasMoreTopics: false
};
const data = createEmptyReaderData();

function runtime(identityKey: string | undefined = 'nodeseek:123', available = true): UserRouteRuntimeValue {
  return {
    enabledSources: ['nodeseek'],
    account: {
      linuxDoVerificationVisible: false,
      readGateway: {} as UserRouteRuntimeValue['account']['readGateway'],
      reconcileAccountStatus: jest.fn(async () => undefined),
      requestNodeSeekVerification: jest.fn(),
      sessionEpochs: initialForumSessionEpochs,
      showLinuxDoVerification: jest.fn(() => undefined),
      showYaohuoLogin: jest.fn()
    },
    nodeSeekMessaging: { identityKey, available },
    appActive: true,
    notify: jest.fn(),
    reader: { data, dataRef: { current: data }, commit: jest.fn() },
    topicStateIndex: createTopicListItemStateIndex(data)
  };
}

function setProfile(value: UserProfile | null) {
  jest.mocked(useUserController).mockReturnValue({
    currentUserFollowed: false,
    userProfile: value,
    selectedUser: profile,
    userBusy: false,
    userError: null,
    userLoadingMoreReplies: false,
    userLoadingMoreTopics: false,
    refreshUser: jest.fn(),
    loadMoreUserReplies: jest.fn(),
    loadMoreUserTopics: jest.fn()
  } as unknown as ReturnType<typeof useUserController>);
}

const screenProps = () => jest.mocked(UserScreen).mock.calls.at(-1)![0];
const Stack = createNativeStackNavigator<RootStackParamList>();

describe('NodeSeek profile private conversation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRealUserScreen = false;
    setProfile(profile);
  });

  it('ignores a queued original profile link after a warm link opens a topic', async () => {
    mockUseRealUserScreen = true;
    const navigation = createNavigationContainerRef<RootStackParamList>();
    const subscription = Linking.addEventListener('url', () => {});
    const addEventListener = jest.fn<typeof Linking.addEventListener>(() => subscription);
    const linking = { addEventListener, getInitialURL: async () => null };
    const openOriginal = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const pushTopic = (destination: RootStackParamList['Topic']) => {
      navigation.navigate('Topic', destination);
      return true;
    };
    function Routes() {
      useAppDeepLinkNavigation(linking, pushTopic);
      return (
        <NavigationContainer ref={navigation}>
          <Stack.Navigator initialRouteName="User" screenOptions={{ headerShown: false }}>
            <Stack.Screen name="User" component={UserRoute} initialParams={{ user: profile }} />
            <Stack.Screen name="Topic">{() => <Text>链接主题</Text>}</Stack.Screen>
          </Stack.Navigator>
        </NavigationContainer>
      );
    }
    const view = await render(
      <UserRouteRuntimeProvider value={runtime()}>
        <Routes />
      </UserRouteRuntimeProvider>
    );
    try {
      expect(view.getByLabelText('原站')).toBeTruthy();
      const [[, openLink]] = addEventListener.mock.calls;
      await act(async () => {
        openLink({ url: 'https://linux.do/t/topic/123' });
        expect(navigation.getCurrentRoute()?.name).toBe('Topic');
        await fireEvent.press(view.getByLabelText('原站', { includeHiddenElements: true }));
      });
      expect(openOriginal).not.toHaveBeenCalled();
      await act(() => navigation.goBack());
      await fireEvent.press(view.getByLabelText('原站'));
      expect(openOriginal).toHaveBeenCalledTimes(1);
      expect(openOriginal).toHaveBeenCalledWith(profile.url);
    } finally {
      openOriginal.mockRestore();
      await view.unmount();
    }
  });

  it.each(['profile-back', 'profile-follow', 'disabled-back', 'disabled-manage'] as const)(
    'keeps the active Topic when the previous User route receives a queued %s action',
    async (action) => {
      const navigationRef = createNavigationContainerRef<RootStackParamList>();
      const disabled = action === 'disabled-back' || action === 'disabled-manage';
      const value = runtime();
      const view = await render(
        <UserRouteRuntimeProvider value={disabled ? { ...value, enabledSources: [] } : value}>
          <NavigationContainer ref={navigationRef}>
            <Stack.Navigator initialRouteName="MainTabs" screenOptions={{ headerShown: false }}>
              <Stack.Screen name="MainTabs">{() => null}</Stack.Screen>
              <Stack.Screen name="User" component={UserRoute} />
              <Stack.Screen name="Topic">{() => null}</Stack.Screen>
            </Stack.Navigator>
          </NavigationContainer>
        </UserRouteRuntimeProvider>
      );
      await act(() => navigationRef.navigate('User', { user: profile }));
      const label = action === 'disabled-manage' ? '管理内容源' : '返回';
      const click = disabled ? view.getByLabelText(label).props.onClick : undefined;
      const actions = disabled ? undefined : screenProps();
      const topic: Topic = {
        source: 'nodeseek',
        id: '42',
        title: 'Reply target',
        author: 'writer',
        createdAt: '2026-10-24T00:00:00Z',
        url: 'https://www.nodeseek.com/post-42-1'
      };

      await act(() => navigationRef.navigate('Topic', { topic }));
      const topicKey = navigationRef.getCurrentRoute()?.key;
      expect(navigationRef.getCurrentRoute()?.name).toBe('Topic');
      await act(() => {
        if (disabled) click({ target: 1, currentTarget: 1, nativeEvent: {} });
        else if (action === 'profile-follow') actions?.onToggleFollow(profile);
        else actions?.onBack();
      });
      expect(navigationRef.getCurrentRoute()?.key).toBe(topicKey);
      expect(value.reader.commit).not.toHaveBeenCalled();

      await act(() => navigationRef.goBack());
      expect(navigationRef.getCurrentRoute()?.name).toBe('User');
      if (disabled) await fireEvent.press(view.getByLabelText(label));
      else {
        if (action === 'profile-follow') {
          await act(() => screenProps().onToggleFollow(profile));
          expect(value.reader.commit).toHaveBeenCalledTimes(1);
          expect(value.reader.commit).toHaveBeenCalledWith(expect.objectContaining({ type: 'follow', enabled: true }));
        }
        await act(() => screenProps().onBack());
      }
      expect(navigationRef.getCurrentRoute()?.name).toBe('MainTabs');
    }
  );

  it.each(['topic', 'private-message'] as const)(
    'ignores queued %s navigation after leaving the profile and permits revisiting after return',
    async (destination) => {
      const navigationRef = createNavigationContainerRef<RootStackParamList>();
      const view = await render(
        <UserRouteRuntimeProvider value={runtime()}>
          <NavigationContainer ref={navigationRef}>
            <Stack.Navigator initialRouteName="User">
              <Stack.Screen name="User" component={UserRoute} initialParams={{ user: profile }} />
              <Stack.Screen name="Topic">{() => null}</Stack.Screen>
              <Stack.Screen name="NotificationDetail">{() => null}</Stack.Screen>
            </Stack.Navigator>
          </NavigationContainer>
        </UserRouteRuntimeProvider>
      );
      const props = screenProps();
      const topic: Topic = {
        source: 'nodeseek',
        id: '42',
        title: 'Reply target',
        author: 'writer',
        createdAt: '2026-10-24T00:00:00Z',
        url: 'https://www.nodeseek.com/post-42-1'
      };
      const open = destination === 'topic' ? () => props.onOpenTopic(topic) : props.onPrivateMessage!;
      const expectedRoute = destination === 'topic' ? 'Topic' : 'NotificationDetail';
      await act(() => {
        open();
        open();
        props.onOpenTopic({ ...topic, id: '43' });
      });
      expect(navigationRef.getRootState()?.routes.map((route) => route.name)).toEqual(['User', expectedRoute]);
      await act(() => navigationRef.goBack());
      await act(() => open());
      expect(navigationRef.getRootState()?.routes.map((route) => route.name)).toEqual(['User', expectedRoute]);
      await view.unmount();
    }
  );

  it('passes the requested reply activity from the profile route to its screen', async () => {
    await render(
      <UserRouteRuntimeProvider value={runtime()}>
        <NavigationContainer>
          <UserRoute
            navigation={{ goBack: jest.fn() } as never}
            route={{ key: 'user', name: 'User', params: { user: profile, initialTab: 'replies' } }}
          />
        </NavigationContainer>
      </UserRouteRuntimeProvider>
    );
    expect(screenProps().initialTab).toBe('replies');
  });

  it('does not open a login surface from a captured private-message action after losing focus', async () => {
    const value = runtime('', false);
    let focused = true;
    const view = await render(
      <UserRouteRuntimeProvider value={value}>
        <NavigationContainer>
          <UserRoute
            navigation={{ goBack: jest.fn(), isFocused: () => focused } as never}
            route={{ key: 'user', name: 'User', params: { user: profile } }}
          />
        </NavigationContainer>
      </UserRouteRuntimeProvider>
    );
    const open = screenProps().onPrivateMessage!;
    focused = false;
    open();
    expect(value.account.requestNodeSeekVerification).not.toHaveBeenCalled();
    focused = true;
    open();
    expect(value.account.requestNodeSeekVerification).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('opens a transient conversation with the resolved UID and latest account, preserving the profile stack', async () => {
    const push = jest.fn();
    const firstRuntime = runtime();
    const tree = (value: UserRouteRuntimeValue) => (
      <UserRouteRuntimeProvider value={value}>
        <NavigationContainer>
          <UserRoute
            navigation={{ push, goBack: jest.fn(), isFocused: () => true } as never}
            route={{ key: 'user', name: 'User', params: { user: { ...profile, id: undefined } } }}
          />
        </NavigationContainer>
      </UserRouteRuntimeProvider>
    );
    const view = await render(tree(firstRuntime));
    screenProps().onPrivateMessage!();
    expect(push).toHaveBeenLastCalledWith('NotificationDetail', {
      identityKey: 'nodeseek:123',
      notification: expect.objectContaining({
        id: 'conversation:23042',
        source: 'nodeseek',
        kind: 'private-message',
        unread: false,
        createdAt: null,
        actor: expect.objectContaining({ id: '23042', name: '收件人' }),
        target: { type: 'private-conversation', conversationId: '23042' }
      })
    });
    expect(firstRuntime.reader.commit).not.toHaveBeenCalled();
    await view.rerender(tree(runtime('nodeseek:456')));
    screenProps().onPrivateMessage!();
    expect(push.mock.calls.at(-1)![1]).toEqual(expect.objectContaining({ identityKey: 'nodeseek:456' }));
    const loggedOut = runtime('', false);
    await view.rerender(tree(loggedOut));
    screenProps().onPrivateMessage!();
    expect(loggedOut.account.requestNodeSeekVerification).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['own profile', profile, 'nodeseek:23042'],
    ['unresolved profile', null, 'nodeseek:123'],
    ['username instead of UID', { ...profile, id: 'recipient' }, 'nodeseek:123'],
    ['unsafe UID', { ...profile, id: '9007199254740992' }, 'nodeseek:123'],
    ['another source', { ...profile, source: 'linuxdo' as const }, 'nodeseek:123']
  ])('hides messaging for %s', async (_name, value, identityKey) => {
    setProfile(value);
    await render(
      <UserRouteRuntimeProvider value={runtime(identityKey)}>
        <NavigationContainer>
          <UserRoute
            navigation={{ goBack: jest.fn() } as never}
            route={{ key: 'user', name: 'User', params: { user: profile } }}
          />
        </NavigationContainer>
      </UserRouteRuntimeProvider>
    );
    expect(screenProps().onPrivateMessage).toBeUndefined();
  });
});
