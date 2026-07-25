import { jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import { createRef } from 'react';
import type { WebView } from 'react-native-webview';

let nodeImageWebViewProps: Record<string, any> = {};

jest.mock('react-native-webview', () => {
  const React = require('react');
  const ReactNative = require('react-native');
  return {
    WebView: React.forwardRef(function MockWebView(props: Record<string, unknown>, _ref: unknown) {
      nodeImageWebViewProps = props;
      return React.createElement(ReactNative.View, { testID: 'nodeimage-webview' });
    })
  };
});
jest.mock('../../src/components/AppControls', () => ({
  AppButton: () => null
}));
jest.mock('../../src/components/LoginWebViewModal', () => {
  const React = require('react');
  const ReactNative = require('react-native');
  return {
    LoginWebViewModal: ({ children, visible }: { children: unknown; visible: boolean }) => (
      visible ? React.createElement(ReactNative.View, null, children) : null
    )
  };
});
jest.mock('../../src/components/ImagePreviewModal', () => ({
  ImagePreviewModal: () => null
}));
jest.mock('../../src/app/LinuxDoVerifyModal', () => ({
  MemoizedLinuxDoVerifyModal: () => null
}));

import { GlobalModalHost } from '../../src/app/GlobalModalHost';

describe('GlobalModalHost NodeImage authorization boundary', () => {
  it('[REG-ACCOUNT-010] injects no script globally and delegates one exact document settlement', async () => {
    const handleNodeImageAuthDocumentLoaded = jest.fn();
    const handleNodeImageAuthDocumentStarted = jest.fn();
    await render(<GlobalModalHost {...({
      checking: false,
      closeImagePreview: jest.fn(),
      closeNodeImageAuthPanel: jest.fn(),
      credentialFillAttempt: 0,
      credentialFillPending: false,
      handleCredentialLoginFormMessage: jest.fn(),
      handleLinuxDoMessage: jest.fn(),
      handleLinuxDoNavigation: jest.fn(),
      handleNodeImageAuthDocumentLoaded,
      handleNodeImageAuthDocumentStarted,
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
      nodeImageAuthError: '',
      nodeImageAuthUrl: 'https://www.nodeseek.com/connect?target=NodeImage',
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
      showNextImage: jest.fn(),
      showNodeImageAuthPanel: true,
      showPreviousImage: jest.fn(),
      styles: { actions: {}, webViewErrorPlaceholder: {} },
      theme: {},
      webViewBlockMessage: '',
      changeLinuxDoPanel: jest.fn(),
      checkLinuxDoCookie: jest.fn(),
      clearLinuxDoCookie: jest.fn()
    } as any)} />);

    expect(nodeImageWebViewProps.injectedJavaScript).toBeUndefined();
    await act(() => {
      nodeImageWebViewProps.onLoadStart({
        nativeEvent: { url: 'https://www.nodeseek.com/connect?target=NodeImage' }
      });
      nodeImageWebViewProps.onLoadEnd({
        nativeEvent: { url: 'https://www.nodeseek.com/connect?target=NodeImage' }
      });
    });
    expect(handleNodeImageAuthDocumentStarted).toHaveBeenCalledTimes(1);
    expect(handleNodeImageAuthDocumentLoaded).toHaveBeenCalledTimes(1);
  });
});
