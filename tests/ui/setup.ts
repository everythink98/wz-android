import { notifyManager } from '@tanstack/react-query';
import { act } from 'react';
import { appQueryClient } from '@/platform/query/serverState';

jest.mock('@/platform/android/forumContentSelection', () => {
  const React = require('react') as typeof import('react');
  const { Text, View } = require('react-native') as typeof import('react-native');
  return {
    NativeForumSelectionSurface: ({
      children,
      fallbackText,
      testID,
      textColor,
      ...props
    }: import('@/platform/android/forumContentSelection').NativeForumSelectionSurfaceProps) =>
      React.createElement(
        View,
        { ...props, testID } as any,
        React.createElement(Text, { selectable: true, style: { color: textColor } }, fallbackText),
        children
      )
  };
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
