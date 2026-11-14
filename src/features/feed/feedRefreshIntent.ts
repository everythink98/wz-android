type Request = Readonly<object>;
type Refresh = { kind: 'idle' } | { kind: 'refreshing'; request: Request };

export function createFeedRefreshIntent() {
  let state: Refresh = { kind: 'idle' };
  const owns = (request: Request) => state.kind === 'refreshing' && state.request === request;
  return {
    owns,
    get refreshing() {
      return state.kind === 'refreshing';
    },
    begin() {
      const request = {};
      state = { kind: 'refreshing', request };
      return request;
    },
    finished(request: Request) {
      if (owns(request)) state = { kind: 'idle' };
    },
    invalidate() {
      state = { kind: 'idle' };
    }
  };
}
