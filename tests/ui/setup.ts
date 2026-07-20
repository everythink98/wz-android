import { appQueryClient } from '../../src/app/serverState';

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
