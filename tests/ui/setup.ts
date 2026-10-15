import 'react-native-gesture-handler/jestSetup';
import { notifyManager } from '@tanstack/react-query';
import { act } from 'react';
import { NativeModules } from 'react-native';
import { appQueryClient } from '@/platform/query/serverState';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest'));

jest.mock('react-native/Libraries/Components/Switch/AndroidSwitchNativeComponent', () => {
  const React = require('react') as typeof import('react');
  const actual = jest.requireActual<Record<string, unknown>>(
    'react-native/Libraries/Components/Switch/AndroidSwitchNativeComponent'
  );
  const { default: mockNativeComponent } = jest.requireActual<{
    default: (name: string) => React.ComponentType<Record<string, unknown>>;
  }>('@react-native/jest-preset/jest/mockNativeComponent');
  const NativeSwitch = mockNativeComponent('RCTSwitch');
  return {
    ...actual,
    __esModule: true,
    default: React.forwardRef(function MockAndroidSwitch(
      props: Record<string, unknown>,
      ref: React.ForwardedRef<unknown>
    ) {
      // RNTL's shared switch host exposes Android's intrinsic checked/disabled state.
      return React.createElement(NativeSwitch, { ...props, value: props.on, disabled: props.enabled === false, ref });
    })
  };
});

NativeModules.NetworkProxyModule = {
  ...NativeModules.NetworkProxyModule,
  getDefaultWebViewUserAgent: jest.fn(async () => 'native-provider-user-agent')
};

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  const WebView = React.forwardRef(function MockWebView(props: Record<string, unknown>, ref: unknown) {
    const postMessage = React.useMemo(() => jest.fn(), []);
    const requestFocus = React.useMemo(() => jest.fn(), []);
    const reload = React.useMemo(() => jest.fn(), []);
    React.useImperativeHandle(ref, () => ({ postMessage, reload, requestFocus }), [postMessage, reload, requestFocus]);
    return React.createElement(View, {
      ...props,
      testID: props.testID || 'mock-webview',
      postMessageMock: postMessage,
      requestFocusMock: requestFocus,
      reloadMock: reload
    });
  });
  return { WebView };
});

notifyManager.setNotifyFunction((callback) => {
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    act(() => {
      callback();
    });
  } finally {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});

const defaultOptions = appQueryClient.getDefaultOptions();
appQueryClient.setDefaultOptions({
  ...defaultOptions,
  mutations: {
    ...defaultOptions.mutations,
    gcTime: Infinity
  },
  queries: {
    ...defaultOptions.queries,
    gcTime: Infinity
  }
});

afterEach(() => {
  appQueryClient.clear();
});

afterAll(() => {
  appQueryClient.clear();
});
