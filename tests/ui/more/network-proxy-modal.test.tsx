import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '../render';
import React from 'react';
import { Alert, Keyboard, StyleSheet } from 'react-native';
import { createEmptyNetworkProxyState, type NetworkProxyProfile } from '@/platform/network/networkProxy';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { NetworkProxyScreen } from '@/features/more/components/NetworkProxyScreen';
import { createTheme } from '@/ui/theme/tokens';
import { createTestStyles as createStyles } from '../styleFixture';

let mockBottomInset = 0;
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual<typeof import('react-native-safe-area-context')>('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: mockBottomInset, left: 0 })
}));

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return {
    Activity: Icon,
    ArrowLeft: Icon,
    Check: Icon,
    Info: Icon,
    Pencil: Icon,
    Plus: Icon,
    Trash2: Icon,
    X: Icon
  };
});

const readerData = createEmptyReaderData();
const theme = createTheme(readerData.settings);
const styles = createStyles(theme, readerData.settings, 800);
const primaryProfile: NetworkProxyProfile = {
  id: 'proxy-primary',
  name: '公司代理',
  protocol: 'socks5',
  host: '10.0.0.2',
  port: 1080,
  username: 'alice',
  password: 'secret'
};
const backupProfile: NetworkProxyProfile = {
  id: 'proxy-backup',
  name: '备用代理',
  protocol: 'http',
  host: 'proxy.example.com',
  port: 8080
};

function proxyScreen(overrides: Partial<React.ComponentProps<typeof NetworkProxyScreen>> = {}) {
  const props: React.ComponentProps<typeof NetworkProxyScreen> = {
    applyError: '',
    applyStatus: 'idle',
    proxyState: createEmptyNetworkProxyState(),
    styles,
    theme,
    active: true,
    onClose: jest.fn(),
    onDeleteProfile: jest.fn(async () => undefined),
    onSelectProfile: jest.fn(async () => undefined),
    onUpsertProfile: jest.fn(async () => undefined),
    ...overrides
  };
  return <NetworkProxyScreen {...props} />;
}

afterEach(() => {
  mockBottomInset = 0;
  jest.restoreAllMocks();
});

describe('Network proxy settings', () => {
  it('allows tapping the current profile to retry a failed application', async () => {
    const onSelectProfile = jest.fn(async () => undefined);
    const view = await render(
      proxyScreen({
        applyStatus: 'failed',
        applyError: '代理应用失败',
        proxyState: { enabled: true, activeId: primaryProfile.id, profiles: [primaryProfile] },
        onSelectProfile
      })
    );
    await fireEvent.press(view.getByText(primaryProfile.name));
    expect(onSelectProfile).toHaveBeenCalledWith(primaryProfile.id);
  });

  it.each(['light', 'dark'] as const)('matches the %s page background throughout its transition', async (mode) => {
    const theme = createTheme({ theme: mode });
    const view = await render(proxyScreen({ theme }));
    expect(view.root?.queryAll((node) => String(node.type) === 'Modal' && node.props.visible)).toHaveLength(0);
    expect(StyleSheet.flatten(view.getByTestId('network-proxy-settings').props.style).backgroundColor).toBe(
      theme.background
    );
  });

  it('shows field errors and does not save an empty proxy profile', async () => {
    const onUpsertProfile = jest.fn(async (_profile: NetworkProxyProfile) => undefined);
    const view = await render(proxyScreen({ onUpsertProfile }));

    await fireEvent.press(view.getByText('添加代理'));
    await fireEvent.press(view.getByLabelText('确定'));

    expect(view.getByText('请填写名称')).toBeTruthy();
    expect(view.getByText('请填写服务器')).toBeTruthy();
    expect(view.getByText('端口必须是 1-65535')).toBeTruthy();
    expect(onUpsertProfile).not.toHaveBeenCalled();
  });

  it('keeps a valid draft editable after saving the proxy profile fails', async () => {
    const onUpsertProfile = jest.fn(async (_profile: NetworkProxyProfile) => {
      throw new Error('代理保存失败');
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const view = await render(proxyScreen({ onUpsertProfile }));

    await fireEvent.press(view.getByText('添加代理'));
    await fireEvent.changeText(view.getByLabelText('名称'), '公司代理');
    await fireEvent.changeText(view.getByLabelText('服务器'), '127.0.0.1');
    await fireEvent.changeText(view.getByLabelText('端口'), '1080');
    await fireEvent.changeText(view.getByLabelText('密码'), ' ');
    await fireEvent.press(view.getByLabelText('确定'));

    await waitFor(() => {
      expect(alert).toHaveBeenCalledWith('服务器代理', '代理保存失败');
    });
    expect(onUpsertProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '公司代理',
        protocol: 'socks5',
        host: '127.0.0.1',
        port: 1080,
        password: ' '
      })
    );
    expect(view.getByLabelText('名称').props.value).toBe('公司代理');
    expect(view.getByLabelText('服务器').props.value).toBe('127.0.0.1');
    expect(view.getByLabelText('端口').props.value).toBe('1080');
    expect(view.getByLabelText('密码').props.value).toBe(' ');
    expect(view.getByLabelText('确定').props.accessibilityState.disabled).toBe(false);
    const firstProfile = onUpsertProfile.mock.calls[0]![0];
    await fireEvent.changeText(view.getByLabelText('端口'), '1081');
    await fireEvent.press(view.getByLabelText('确定'));
    expect(onUpsertProfile.mock.calls[1]![0]).toEqual({ ...firstProfile, port: 1081 });
  });

  it.each(['success', 'failure'] as const)(
    'ignores an old save %s after route blur closes the proxy modal and a new draft opens',
    async (outcome) => {
      const saving = Promise.withResolvers<void>();
      const onUpsertProfile = jest.fn<(_profile: NetworkProxyProfile) => Promise<void>>(() => saving.promise);
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      const view = await render(proxyScreen({ onUpsertProfile }));

      await fireEvent.press(view.getByText('添加代理'));
      await fireEvent.changeText(view.getByLabelText('名称'), '旧表单');
      await fireEvent.changeText(view.getByLabelText('服务器'), '127.0.0.1');
      await fireEvent.changeText(view.getByLabelText('端口'), '1080');
      await fireEvent.press(view.getByLabelText('确定'));
      expect(onUpsertProfile).toHaveBeenCalledTimes(1);

      await view.rerender(proxyScreen({ active: false, onUpsertProfile }));
      await view.rerender(proxyScreen({ active: true, onUpsertProfile }));
      await fireEvent.press(view.getByText('添加代理'));
      await fireEvent.changeText(view.getByLabelText('名称'), '新表单草稿');
      await act(async () => {
        if (outcome === 'success') saving.resolve();
        else saving.reject(new Error('旧保存失败'));
        await Promise.resolve();
      });

      expect(view.getByLabelText('名称').props.value).toBe('新表单草稿');
      expect(view.getByLabelText('确定').props.accessibilityState.disabled).toBe(false);
      expect(alert).not.toHaveBeenCalled();
      expect(onUpsertProfile).toHaveBeenCalledTimes(1);
    }
  );

  it('keeps a reopened proxy save busy when the previous route session finishes saving', async () => {
    const oldSave = Promise.withResolvers<void>();
    const currentSave = Promise.withResolvers<void>();
    const onUpsertProfile = jest
      .fn<(_profile: NetworkProxyProfile) => Promise<void>>()
      .mockImplementationOnce(() => oldSave.promise)
      .mockImplementation(() => currentSave.promise);
    const view = await render(proxyScreen({ onUpsertProfile }));
    try {
      await fireEvent.press(view.getByText('添加代理'));
      await fireEvent.changeText(view.getByLabelText('名称'), '旧表单');
      await fireEvent.changeText(view.getByLabelText('服务器'), '127.0.0.1');
      await fireEvent.changeText(view.getByLabelText('端口'), '1080');
      await fireEvent.press(view.getByLabelText('确定'));

      await view.rerender(proxyScreen({ active: false, onUpsertProfile }));
      await view.rerender(proxyScreen({ active: true, onUpsertProfile }));
      await fireEvent.press(view.getByText('添加代理'));
      await fireEvent.changeText(view.getByLabelText('名称'), '本次表单');
      await fireEvent.changeText(view.getByLabelText('服务器'), '127.0.0.2');
      await fireEvent.changeText(view.getByLabelText('端口'), '8080');
      await fireEvent.press(view.getByLabelText('确定'));
      expect(onUpsertProfile).toHaveBeenCalledTimes(2);

      await act(async () => oldSave.resolve());
      expect(view.getByLabelText('名称').props.value).toBe('本次表单');
      expect(view.getByLabelText('保存中').props.accessibilityState.disabled).toBe(true);
      await fireEvent.press(view.getByLabelText('保存中'));
      expect(onUpsertProfile).toHaveBeenCalledTimes(2);

      await act(async () => currentSave.resolve());
      expect(view.queryByPlaceholderText('名称')).toBeNull();
      await fireEvent.press(view.getByText('添加代理'));
      expect(view.getByLabelText('名称').props.value).toBe('');
      expect(view.getByLabelText('确定').props.accessibilityState.disabled).toBe(false);
    } finally {
      await act(async () => {
        oldSave.resolve();
        currentSave.resolve();
      });
    }
  });

  it('gives proxy passwords secure input semantics', async () => {
    const view = await render(proxyScreen());

    await fireEvent.press(view.getByText('添加代理'));
    const password = view.getByLabelText('密码');

    expect(password.props.secureTextEntry).toBe(true);
    expect(password.props.textContentType).toBe('password');
    expect(password.props.autoComplete).toBe('current-password');
  });

  it('selects and edits existing proxy profiles without losing their identity', async () => {
    const onSelectProfile = jest.fn(async (_id: string) => undefined);
    const onUpsertProfile = jest.fn(async (_profile: NetworkProxyProfile) => undefined);
    const view = await render(
      proxyScreen({
        proxyState: {
          activeId: primaryProfile.id,
          enabled: false,
          profiles: [primaryProfile, backupProfile]
        },
        onSelectProfile,
        onUpsertProfile
      })
    );

    await fireEvent.press(view.getByText('备用代理'));
    await waitFor(() => {
      expect(onSelectProfile).toHaveBeenCalledWith(backupProfile.id);
    });

    await fireEvent.press(view.getAllByLabelText('编辑代理')[1]);
    expect(view.getByText('编辑代理')).toBeTruthy();
    expect(view.getByLabelText('名称').props.value).toBe('备用代理');
    expect(view.getByLabelText('服务器').props.value).toBe('proxy.example.com');
    await fireEvent.changeText(view.getByLabelText('名称'), '家庭代理');
    await fireEvent.press(view.getByLabelText('确定'));

    await waitFor(() => {
      expect(onUpsertProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          id: backupProfile.id,
          name: '家庭代理',
          protocol: 'http',
          host: 'proxy.example.com',
          port: 8080
        })
      );
    });
  });

  it.each([0, 24, 48])(
    'uses Android keyboard height once and releases it with a %s dp system bottom inset',
    async (bottom) => {
      mockBottomInset = bottom;
      let showKeyboard: ((event: { endCoordinates: { height: number } }) => void) | undefined;
      let hideKeyboard: (() => void) | undefined;
      jest.spyOn(Keyboard, 'addListener').mockImplementation((event, listener) => {
        if (event === 'keyboardDidShow') showKeyboard = listener as typeof showKeyboard;
        if (event === 'keyboardDidHide') hideKeyboard = listener as typeof hideKeyboard;
        return { remove: jest.fn() } as never;
      });
      const view = await render(proxyScreen());

      await fireEvent.press(view.getByText('添加代理'));
      await act(async () => {
        showKeyboard?.({ endCoordinates: { height: 240 } });
      });
      expect(StyleSheet.flatten(view.getByTestId('modal-sheet').props.style).marginBottom).toBe(240);

      await act(async () => {
        hideKeyboard?.();
      });
      expect(StyleSheet.flatten(view.getByTestId('modal-sheet').props.style).marginBottom).toBeUndefined();
    }
  );

  it('deletes selected profiles only after destructive confirmation', async () => {
    const onDeleteProfile = jest.fn(async (_id: string) => undefined);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const view = await render(
      proxyScreen({
        proxyState: {
          activeId: primaryProfile.id,
          enabled: false,
          profiles: [primaryProfile, backupProfile]
        },
        onDeleteProfile
      })
    );

    await fireEvent(view.getByText('备用代理'), 'longPress');
    expect(view.getByLabelText('删除选中的代理')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('删除选中的代理'));
    expect(alert).toHaveBeenCalledWith('删除代理', '确定删除选中的 1 个代理？', expect.any(Array));
    expect(onDeleteProfile).not.toHaveBeenCalled();

    const buttons = alert.mock.calls[0]?.[2];
    buttons?.find((button) => button.text === '取消')?.onPress?.();
    expect(onDeleteProfile).not.toHaveBeenCalled();
    await act(async () => {
      buttons?.find((button) => button.text === '删除')?.onPress?.();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(onDeleteProfile).toHaveBeenCalledWith(backupProfile.id);
    });
  });
});
