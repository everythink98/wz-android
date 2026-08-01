import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';
import { createEmptyNetworkProxyState, type NetworkProxyProfile } from '@/platform/network/networkProxy';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { NetworkProxyModal } from '@/screens/more/NetworkProxyModal';
import { createTheme } from '@/ui/theme/tokens';
import { createTestStyles as createStyles } from './styleFixture';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 })
}));

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { ArrowLeft: Icon, Check: Icon, Info: Icon, Trash2: Icon, X: Icon };
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

function proxyModal(overrides: Partial<React.ComponentProps<typeof NetworkProxyModal>> = {}) {
  const props: React.ComponentProps<typeof NetworkProxyModal> = {
    activeProfile: null,
    applyError: '',
    applyStatus: 'idle',
    proxyState: createEmptyNetworkProxyState(),
    styles,
    theme,
    visible: true,
    onClose: jest.fn(),
    onDeleteProfile: jest.fn(async () => undefined),
    onSelectProfile: jest.fn(async () => undefined),
    onSetEnabled: jest.fn(async () => undefined),
    onTestProfile: jest.fn(async () => ({ ok: true, latencyMs: 10 })),
    onUpsertProfile: jest.fn(async () => undefined),
    ...overrides
  };
  return <NetworkProxyModal {...props} />;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Network proxy modal', () => {
  it('[REG-PROXY-003] exposes an explicit direct-connection reset after proxy recovery fails', async () => {
    const onSetEnabled = jest.fn(async (_enabled: boolean) => undefined);
    const view = await render(
      proxyModal({
        applyError: '代理配置读取失败，已阻止网络请求',
        applyStatus: 'failed',
        onSetEnabled
      })
    );

    await fireEvent.press(view.getByLabelText('重置为直连'));

    await waitFor(() => expect(onSetEnabled).toHaveBeenCalledWith(false));
  });

  it('shows field errors and does not save an empty proxy profile', async () => {
    const onUpsertProfile = jest.fn(async (_profile: NetworkProxyProfile) => undefined);
    const view = await render(proxyModal({ onUpsertProfile }));

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
    const view = await render(proxyModal({ onUpsertProfile }));

    await fireEvent.press(view.getByText('添加代理'));
    await fireEvent.changeText(view.getByPlaceholderText('名称'), '公司代理');
    await fireEvent.changeText(view.getByPlaceholderText('服务器'), '127.0.0.1');
    await fireEvent.changeText(view.getByPlaceholderText('端口'), '1080');
    await fireEvent.press(view.getByLabelText('确定'));

    await waitFor(() => {
      expect(alert).toHaveBeenCalledWith('服务器代理', '代理保存失败');
    });
    expect(onUpsertProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '公司代理',
        protocol: 'socks5',
        host: '127.0.0.1',
        port: 1080
      })
    );
    expect(view.getByPlaceholderText('名称').props.value).toBe('公司代理');
    expect(view.getByPlaceholderText('服务器').props.value).toBe('127.0.0.1');
    expect(view.getByPlaceholderText('端口').props.value).toBe('1080');
    expect(view.getByLabelText('确定').props.accessibilityState.disabled).toBe(false);
  });

  it('[REG-PROXY-005] gives proxy passwords secure input semantics', async () => {
    const view = await render(proxyModal());

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
      proxyModal({
        activeProfile: primaryProfile,
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
    expect(view.getByPlaceholderText('名称').props.value).toBe('备用代理');
    expect(view.getByPlaceholderText('服务器').props.value).toBe('proxy.example.com');
    await fireEvent.changeText(view.getByPlaceholderText('名称'), '家庭代理');
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

  it('[REG-PROXY-005] shows full connectivity results and optimistically reflects proxy enable requests', async () => {
    const onSetEnabled = jest.fn(async (_enabled: boolean) => undefined);
    const onTestProfile = jest.fn(async (_profile: NetworkProxyProfile) => ({ ok: true, latencyMs: 42 }));
    const proxyState = {
      activeId: primaryProfile.id,
      enabled: false,
      profiles: [primaryProfile]
    };
    const view = await render(
      proxyModal({
        activeProfile: primaryProfile,
        proxyState,
        onSetEnabled,
        onTestProfile
      })
    );

    await fireEvent.press(view.getByLabelText('测试代理连通性'));
    await waitFor(() => {
      expect(onTestProfile).toHaveBeenCalledWith(primaryProfile);
      expect(view.getByText(/连通性: 42 ms/)).toBeTruthy();
    });

    expect(view.getByRole('switch').props.accessibilityState.checked).toBe(false);
    await fireEvent.press(view.getByRole('switch'));
    expect(onSetEnabled).toHaveBeenCalledWith(true);
    expect(view.getByRole('switch').props.accessibilityState.checked).toBe(true);
  });

  it('deletes selected profiles only after destructive confirmation', async () => {
    const onDeleteProfile = jest.fn(async (_id: string) => undefined);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const view = await render(
      proxyModal({
        activeProfile: primaryProfile,
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
