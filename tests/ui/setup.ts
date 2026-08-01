import { notifyManager } from '@tanstack/react-query';
import { act } from 'react';
import { appQueryClient } from '@/app/serverState';

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
