import { jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import { createRef } from 'react';
import type { WebView } from 'react-native-webview';

let nodeImageWebViewProps: Record<string, any> = {};
let nodeImageWebViewMounts = 0;
let nodeImageModalProps: Record<string, any> = {};

jest.mock('react-native-webview', () => {
  const React = require('react');
  const ReactNative = require('react-native');
  return {
    WebView: React.forwardRef(function MockWebView(props: Record<string, unknown>, _ref: unknown) {
      React.useEffect(() => {
        nodeImageWebViewMounts += 1;
      }, []);
      nodeImageWebViewProps = props;
      return React.createElement(ReactNative.View, { testID: 'nodeimage-webview' });
    })
  };
});
jest.mock('@/ui/controls/ButtonControls', () => ({
  AppButton: () => null
}));
jest.mock('@/ui/navigation/LoginWebViewModal', () => {
  const React = require('react');
  const ReactNative = require('react-native');
  return {
    LoginWebViewModal: (props: { children: unknown; visible: boolean }) => {
      nodeImageModalProps = props;
      return props.visible ? React.createElement(ReactNative.View, null, props.children) : null;
    }
  };
});
jest.mock('@/ui/media/ImagePreviewModal', () => ({
  ImagePreviewModal: () => null
}));
jest.mock('@/features/account/components/LinuxDoVerifyModal', () => ({
  MemoizedLinuxDoVerifyModal: () => null
}));

import { AccountHost } from '@/features/account/AccountHost';

describe('AccountHost NodeImage authorization boundary', () => {
  beforeEach(() => {
    nodeImageWebViewMounts = 0;
    nodeImageWebViewProps = {};
    nodeImageModalProps = {};
  });

  it('[REG-ACCOUNT-038][REG-PROXY-001] mounts one authorization script and removes it while WebViews are blocked', async () => {
    const baseProps = {
      checking: false,
      closeImagePreview: jest.fn(),
      closeNodeImageAuthPanel: jest.fn(),
      credentialFillAttempt: 0,
      credentialFillPending: false,
      handleCredentialLoginFormMessage: jest.fn(),
      handleLinuxDoMessage: jest.fn(),
      handleLinuxDoNavigation: jest.fn(),
      handleNodeImageAuthMessage: jest.fn(),
      handleNodeImageAuthNavigation: jest.fn(),
      imagePreview: null,
      linuxDoCredentialSaved: false,
      linuxDoLoginFormMode: false,
      linuxDoSession: {},
      linuxDoWebViewError: '',
      linuxDoWebViewKey: 0,
      linuxDoWebViewRef: createRef<WebView>(),
      loadingLinuxDoPage: false,
      loadingNodeImageAuthPage: false,
      mediaSessionIdentity: 'nodeseek:0',
      mountLinuxDoWebView: false,
      nodeImageAuthDocument: {
        injectedJavaScript: 'session-script',
        key: '1:nodeimage-session',
        url: 'https://www.nodeimage.com/'
      },
      nodeImageAuthError: '',
      nodeImageAuthWebViewRef: createRef<WebView>(),
      requestLinuxDoCredentialFill: jest.fn(),
      resetLinuxDoWebView: jest.fn(),
      savePreviewImage: jest.fn(),
      selectPreviewImage: jest.fn(),
      setLinuxDoWebViewErrorForSession: jest.fn(),
      setLoadingLinuxDoPageForSession: jest.fn(),
      setLoadingNodeImageAuthPage: jest.fn(),
      setNodeImageAuthError: jest.fn(),
      showLinuxDoPanel: false,
      showNodeImageAuthPanel: true,
      styles: { actions: {}, webViewErrorPlaceholder: {} },
      theme: {},
      webViewBlockMessage: '',
      changeLinuxDoPanel: jest.fn(),
      checkLinuxDoCookie: jest.fn(),
      clearLinuxDoCookie: jest.fn()
    };
    const view = await render(<AccountHost {...(baseProps as any)} />);

    expect(nodeImageWebViewProps.source).toEqual({ uri: 'https://www.nodeimage.com/' });
    expect(nodeImageWebViewProps.injectedJavaScript).toBe('session-script');
    expect(view.getByTestId('nodeimage-auth-touch-shield', { includeHiddenElements: true })).toBeTruthy();
    expect(nodeImageModalProps.actions).toBeUndefined();
    expect(nodeImageWebViewMounts).toBe(1);

    await act(async () => {
      view.rerender(
        <AccountHost
          {...({
            ...baseProps,
            nodeImageAuthDocument: {
              injectedJavaScript: 'connect-script',
              key: '1:nodeseek-cauth',
              url: 'https://www.nodeseek.com/connect?target=NodeImage'
            }
          } as any)}
        />
      );
    });

    expect(nodeImageWebViewProps.source).toEqual({
      uri: 'https://www.nodeseek.com/connect?target=NodeImage'
    });
    expect(nodeImageWebViewProps.injectedJavaScript).toBe('connect-script');
    expect(nodeImageWebViewMounts).toBe(2);

    await act(async () => {
      view.rerender(
        <AccountHost
          {...({
            ...baseProps,
            nodeImageAuthDocument: {
              injectedJavaScript: 'verify-script',
              key: '1:nodeimage-verify',
              url: 'https://www.nodeimage.com/'
            }
          } as any)}
        />
      );
    });

    expect(nodeImageWebViewProps.source).toEqual({ uri: 'https://www.nodeimage.com/' });
    expect(nodeImageWebViewProps.injectedJavaScript).toBe('verify-script');
    expect(nodeImageWebViewMounts).toBe(3);
    expect(nodeImageModalProps.actions).toBeUndefined();

    await view.rerender(<AccountHost {...({ ...baseProps, webViewBlockMessage: '代理状态切换中' } as any)} />);
    expect(nodeImageModalProps.error).toBe('代理状态切换中');
    expect(view.queryByTestId('nodeimage-webview', { includeHiddenElements: true })).toBeNull();
    expect(nodeImageWebViewMounts).toBe(3);
  });
});
