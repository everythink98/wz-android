import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { focusManager, onlineManager, QueryClientProvider, type InfiniteData } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  NodeSeekAttendanceBoard,
  NodeSeekCreditCurrency,
  NodeSeekCreditEntry,
  NodeSeekCreditPage,
  NodeSeekStardustCreditPage
} from '@/domain/forum/accountData';
import { useNodeSeekCredits, type NodeSeekCreditsGateway } from '@/features/more/useNodeSeekCredits';
import { NodeSeekCreditsScreen } from '@/features/more/NodeSeekCreditsScreen';
import { summarizeCredits } from '@/features/more/nodeSeekCredits';
import { createAppQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import type { ReadGateway } from '@/sources/readGateway';
import { fireEvent, render } from '../render';

afterEach(() => {
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

function entry(change: number, daysAgo = 0, reason = '回帖奖励'): NodeSeekCreditEntry {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(12, 0, 0, 0);
  return { change, balance: 100 + change, reason, createdAt: date.toISOString() };
}

function page(pageNumber: number, entries: NodeSeekCreditEntry[], hasMore = true, userId = '42'): NodeSeekCreditPage {
  return {
    source: 'nodeseek',
    userId,
    entries,
    page: pageNumber,
    total: 80,
    hasMore,
    nextPage: hasMore ? pageNumber + 1 : null
  };
}

function board(userId = '42'): NodeSeekAttendanceBoard {
  return { source: 'nodeseek', userId, list: [], record: null, order: null, total: 0 };
}

async function controller(
  getCredits: NodeSeekCreditsGateway['getNodeSeekCredits'],
  active = true,
  currency: NodeSeekCreditCurrency = 'coin',
  getStardust = jest.fn<NodeSeekCreditsGateway['getNodeSeekStardustCredits']>(),
  client = createAppQueryClient()
) {
  const getAttendance = jest.fn(async ({ userId }: { userId: string }) => board(userId));
  const gateway: NodeSeekCreditsGateway & Pick<ReadGateway, 'getNodeSeekAttendanceBoard'> = {
    getReadPlan: () => ({
      state: 'ready',
      lane: 'authenticated',
      transport: 'managed-session',
      cacheScope: 'authenticated:0'
    }),
    getNodeSeekCredits: getCredits,
    getNodeSeekStardustCredits: getStardust,
    getNodeSeekAttendanceBoard: getAttendance
  };
  const hook = await renderHook(
    ({
      active,
      userId,
      sessionEpoch,
      currency: selectedCurrency
    }: {
      active: boolean;
      userId: string;
      sessionEpoch: number;
      currency?: NodeSeekCreditCurrency;
    }) => useNodeSeekCredits({ active, gateway, userId, sessionEpoch, currency: selectedCurrency ?? currency }),
    {
      initialProps: { active, userId: '42', sessionEpoch: 0 },
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      )
    }
  );
  return { ...hook, client, getAttendance, getStardust };
}

describe('NodeSeek chicken-leg ledger', () => {
  it.each([true, false])(
    'uses only complete device-local ledger records for today attendance income (complete: %s)',
    async (complete) => {
      const client = createAppQueryClient();
      try {
        const yesterday = entry(3, 1, '签到收益');
        client.setQueryData<NodeSeekAttendanceBoard>(
          forumQueryKeys.accountData({
            source: 'nodeseek',
            kind: 'attendance',
            userId: '42',
            sessionEpoch: 0,
            readPlanScope: 'authenticated:0'
          }),
          {
            ...board(),
            record: { id: '1', memberId: '42', dayId: 1, gain: 3, createdAt: yesterday.createdAt }
          }
        );
        client.setQueryData<InfiniteData<NodeSeekCreditPage, number>>(
          forumQueryKeys.accountData({
            source: 'nodeseek',
            kind: 'credits',
            userId: '42',
            sessionEpoch: 0,
            readPlanScope: 'authenticated:0'
          }),
          { pages: [page(1, [complete ? yesterday : entry(3, 0, '签到收益')], !complete)], pageParams: [1] }
        );
        const hook = await controller(
          jest.fn<NodeSeekCreditsGateway['getNodeSeekCredits']>(),
          true,
          'coin',
          jest.fn<NodeSeekCreditsGateway['getNodeSeekStardustCredits']>(),
          client
        );
        expect(hook.result.current.summary.today.complete).toBe(complete);
        expect(hook.result.current.summary.today.attendanceIncome).toBe(complete ? 0 : 3);
        const view = await render(<NodeSeekCreditsScreen {...hook.result.current} />);
        expect(view.getByText(complete ? '签到 0' : '签到收益待补齐')).toBeTruthy();
        expect(view.getByTestId('credits-today-summary').props.children).toBe(complete ? '0' : '待补齐');
      } finally {
        client.clear();
      }
    }
  );

  it.each(['coin', 'stardust'] as const)(
    'keeps the %s cache across reentry, focus, reconnect and long absence until manual refresh',
    async (currency) => {
      const client = createAppQueryClient();
      const defaults = client.getDefaultOptions();
      client.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, gcTime: 10 } });
      const getCoin = jest
        .fn<NodeSeekCreditsGateway['getNodeSeekCredits']>()
        .mockResolvedValue(page(1, [entry(3)], false));
      const getStar = jest.fn<NodeSeekCreditsGateway['getNodeSeekStardustCredits']>().mockResolvedValue({
        source: 'nodeseek',
        userId: '42',
        entries: [entry(3)],
        hasMore: false,
        nextBeforeId: null
      });
      const hook = await controller(getCoin, true, currency, getStar, client);
      await waitFor(() => expect(hook.result.current.summary.today.net).toBe(3));
      await hook.rerender({ active: false, userId: '42', sessionEpoch: 0 });
      await hook.rerender({ active: true, userId: '42', sessionEpoch: 0 });
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
        onlineManager.setOnline(false);
        onlineManager.setOnline(true);
      });
      const read = currency === 'coin' ? getCoin : getStar;
      expect(read).toHaveBeenCalledTimes(1);
      expect(hook.getAttendance).not.toHaveBeenCalled();
      await hook.unmount();
      await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 30)));
      const reopened = await controller(getCoin, true, currency, getStar, client);
      expect(reopened.result.current.summary.today.net).toBe(3);
      expect(read).toHaveBeenCalledTimes(1);
      expect(reopened.getAttendance).not.toHaveBeenCalled();
      getCoin.mockResolvedValue(page(1, [entry(8)], false));
      getStar.mockResolvedValue({
        source: 'nodeseek',
        userId: '42',
        entries: [entry(8)],
        hasMore: false,
        nextBeforeId: null
      });
      await act(async () => reopened.result.current.refresh());
      await waitFor(() => expect(reopened.result.current.summary.today.net).toBe(8));
      expect(read).toHaveBeenCalledTimes(2);
      expect(reopened.getAttendance).not.toHaveBeenCalled();
    }
  );

  it('leaves a cached incomplete page chain paused on return and resumes completion only after refresh', async () => {
    let pageSignal: AbortSignal | undefined;
    const getCredits = jest
      .fn<NodeSeekCreditsGateway['getNodeSeekCredits']>()
      .mockResolvedValueOnce(page(1, [entry(5)]))
      .mockImplementationOnce(({ signal }) => {
        pageSignal = signal;
        return new Promise<NodeSeekCreditPage>(() => undefined);
      })
      .mockResolvedValueOnce(page(1, [entry(8)]))
      .mockResolvedValueOnce(page(2, [entry(2, 1)], false));
    const hook = await controller(getCredits);
    await waitFor(() => expect(getCredits).toHaveBeenCalledTimes(2));
    await hook.rerender({ active: false, userId: '42', sessionEpoch: 0 });
    expect(pageSignal?.aborted).toBe(true);
    await hook.rerender({ active: true, userId: '42', sessionEpoch: 0 });
    expect(hook.result.current.summary.today.net).toBe(5);
    expect(hook.result.current.summary.today.complete).toBe(false);
    expect(getCredits).toHaveBeenCalledTimes(2);
    await act(async () => hook.result.current.refresh());
    await waitFor(() => expect(hook.result.current.summary.today.complete).toBe(true));
    expect(hook.result.current.summary.today.net).toBe(8);
    expect(getCredits.mock.calls.map(([options]) => options.page)).toEqual([1, 2, 1, 2]);
  });

  it('reads again after an initial request was cancelled before producing any cached records', async () => {
    let firstSignal: AbortSignal | undefined;
    const getCredits = jest
      .fn<NodeSeekCreditsGateway['getNodeSeekCredits']>()
      .mockImplementationOnce(({ signal }) => {
        firstSignal = signal;
        return new Promise<NodeSeekCreditPage>(() => undefined);
      })
      .mockResolvedValueOnce(page(1, [entry(8)]))
      .mockResolvedValueOnce(page(2, [entry(2, 1)], false));
    const hook = await controller(getCredits);
    await waitFor(() => expect(getCredits).toHaveBeenCalledTimes(1));
    await hook.rerender({ active: false, userId: '42', sessionEpoch: 0 });
    expect(firstSignal?.aborted).toBe(true);
    await hook.rerender({ active: true, userId: '42', sessionEpoch: 0 });
    await waitFor(() => expect(hook.result.current.summary.today.complete).toBe(true));
    expect(hook.result.current.summary.today.net).toBe(8);
    expect(getCredits.mock.calls.map(([options]) => options.page)).toEqual([1, 1, 2]);
  });

  it('keeps both currency snapshots while switching and still processes explicit write invalidation', async () => {
    const getCoin = jest
      .fn<NodeSeekCreditsGateway['getNodeSeekCredits']>()
      .mockResolvedValue(page(1, [entry(3)], false));
    const getStar = jest.fn<NodeSeekCreditsGateway['getNodeSeekStardustCredits']>().mockResolvedValue({
      source: 'nodeseek',
      userId: '42',
      entries: [entry(7)],
      hasMore: false,
      nextBeforeId: null
    });
    const hook = await controller(getCoin, true, 'coin', getStar);
    await waitFor(() => expect(hook.result.current.summary.today.net).toBe(3));
    await hook.rerender({ active: true, userId: '42', sessionEpoch: 0, currency: 'stardust' });
    await waitFor(() => expect(hook.result.current.summary.today.net).toBe(7));
    await hook.rerender({ active: true, userId: '42', sessionEpoch: 0, currency: 'coin' });
    expect(hook.result.current.summary.today.net).toBe(3);
    await hook.rerender({ active: true, userId: '42', sessionEpoch: 0, currency: 'stardust' });
    expect(hook.result.current.summary.today.net).toBe(7);
    expect(getCoin).toHaveBeenCalledTimes(1);
    expect(getStar).toHaveBeenCalledTimes(1);
    expect(hook.getAttendance).not.toHaveBeenCalled();
    getStar.mockResolvedValue({
      source: 'nodeseek',
      userId: '42',
      entries: [entry(9)],
      hasMore: false,
      nextBeforeId: null
    });
    await act(async () =>
      hook.client.invalidateQueries({
        queryKey: forumQueryKeys.accountData({
          source: 'nodeseek',
          kind: 'stardust-credits',
          userId: '42',
          sessionEpoch: 0,
          readPlanScope: 'authenticated:0'
        }),
        exact: true
      })
    );
    await waitFor(() => expect(hook.result.current.summary.today.net).toBe(9));
    expect(getStar).toHaveBeenCalledTimes(2);
    expect(getCoin).toHaveBeenCalledTimes(1);
  });

  it('refreshes from the list gesture without a duplicate action or instructional copy in the content', async () => {
    const getCredits = jest
      .fn<NodeSeekCreditsGateway['getNodeSeekCredits']>()
      .mockResolvedValueOnce(page(1, [entry(3)], false))
      .mockResolvedValueOnce(page(1, [entry(8)], false));
    const hook = await controller(getCredits);
    await waitFor(() => expect(hook.result.current.summary.today.net).toBe(3));
    const view = await render(<NodeSeekCreditsScreen {...hook.result.current} />);
    expect(view.queryByRole('button', { name: '刷新流水' })).toBeNull();
    expect(view.queryByText('按本机日期汇总；签到资格以原站为准')).toBeNull();
    await act(async () => fireEvent(view.getByTestId('nodeseek-credits-list'), 'refresh'));
    await waitFor(() => expect(hook.result.current.summary.today.net).toBe(8));
    expect(getCredits.mock.calls.map(([options]) => options.page)).toEqual([1, 1]);
  });
  it('withholds every day total when page counts change and refreshes into one consistent set', async () => {
    const getCredits = jest
      .fn<NodeSeekCreditsGateway['getNodeSeekCredits']>()
      .mockResolvedValueOnce(page(1, [entry(5)]))
      .mockResolvedValueOnce({ ...page(2, [entry(5), entry(2, 1)]), total: 81 })
      .mockResolvedValueOnce({ ...page(1, [entry(8)]), total: 81 })
      .mockResolvedValueOnce({ ...page(2, [entry(2, 1)], false), total: 81 });
    const hook = await controller(getCredits);
    await waitFor(() => expect(getCredits).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hook.result.current.busy).toBe(false));
    expect(hook.result.current.summary.today.complete).toBe(false);
    expect(hook.result.current.summary.days.every((day) => !day.complete)).toBe(true);
    const view = await render(<NodeSeekCreditsScreen {...hook.result.current} />);
    expect(view.getByText('流水有更新，请刷新后统计')).toBeTruthy();
    expect(getCredits).toHaveBeenCalledTimes(2);
    await act(async () => hook.result.current.refresh());
    await waitFor(() => expect(hook.result.current.summary.today.complete).toBe(true));
    expect(hook.result.current.summary.today.income).toBe(8);
    expect(getCredits.mock.calls.map(([options]) => options.page)).toEqual([1, 2, 1, 2]);
    await view.rerender(<NodeSeekCreditsScreen {...hook.result.current} />);
    expect(view.queryByText('流水有更新，请刷新后统计')).toBeNull();
  });

  it('stops automatic reads for unordered pages and keeps all amounts when manually completing the ledger', async () => {
    const getCredits = jest
      .fn<NodeSeekCreditsGateway['getNodeSeekCredits']>()
      .mockResolvedValueOnce(page(1, [entry(5), entry(2, 1), entry(3)]))
      .mockResolvedValueOnce(page(2, [entry(4)], false));
    const hook = await controller(getCredits);
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    expect(hook.result.current.summary.ordered).toBe(false);
    expect(hook.result.current.summary.today.complete).toBe(false);
    expect(getCredits).toHaveBeenCalledTimes(1);
    await act(async () => hook.result.current.loadMore());
    await waitFor(() => expect(hook.result.current.summary.today.complete).toBe(true));
    expect(hook.result.current.summary.today.income).toBe(12);
    expect(getCredits).toHaveBeenCalledTimes(2);
  });

  it('recomputes today after midnight even when refreshing returns identical records', async () => {
    jest.useFakeTimers({
      doNotFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
        'queueMicrotask',
        'nextTick',
        'performance'
      ]
    });
    try {
      jest.setSystemTime(new Date(2026, 9, 2, 23, 59));
      const previousDay = page(1, [entry(5)], false);
      const getCredits = jest.fn<NodeSeekCreditsGateway['getNodeSeekCredits']>().mockResolvedValue(previousDay);
      const hook = await controller(getCredits);
      await waitFor(() => expect(hook.result.current.summary.today.income).toBe(5));
      jest.setSystemTime(new Date(2026, 9, 3, 0, 1));
      await hook.rerender({ active: false, userId: '42', sessionEpoch: 0 });
      await hook.rerender({ active: true, userId: '42', sessionEpoch: 0 });
      expect(getCredits).toHaveBeenCalledTimes(1);
      await act(async () => hook.result.current.refresh());
      expect(hook.result.current.summary.today.day).toBe('2026-10-03');
      expect(hook.result.current.summary.today.income).toBe(0);
      expect(hook.result.current.summary.today.complete).toBe(true);
      expect(hook.result.current.summary.days[0].income).toBe(5);
    } finally {
      jest.useRealTimers();
    }
  });

  it('automatically reads pages until today is complete and stops at the older boundary', async () => {
    const getCredits = jest
      .fn<NodeSeekCreditsGateway['getNodeSeekCredits']>()
      .mockResolvedValueOnce(page(1, [entry(5)]))
      .mockResolvedValueOnce(page(2, [entry(2)]))
      .mockResolvedValueOnce(page(3, [entry(-3, 1)]));
    const hook = await controller(getCredits);
    await waitFor(() => expect(hook.result.current.summary.today.complete).toBe(true));
    expect(getCredits.mock.calls.map(([options]) => options.page)).toEqual([1, 2, 3]);
    expect(hook.result.current.summary.today.income).toBe(7);
    expect(hook.result.current.summary.days[1].complete).toBe(false);
    expect(hook.result.current.hasMore).toBe(true);
  });

  it('stops automatic pagination after an error and retries only when the user loads more', async () => {
    let finishRetry: ((page: NodeSeekCreditPage) => void) | undefined;
    const getCredits = jest
      .fn<NodeSeekCreditsGateway['getNodeSeekCredits']>()
      .mockResolvedValueOnce(page(1, [entry(5)]))
      .mockRejectedValueOnce(new Error('网络失败'))
      .mockImplementationOnce(
        () =>
          new Promise<NodeSeekCreditPage>((resolve) => {
            finishRetry = resolve;
          })
      );
    const hook = await controller(getCredits);
    await waitFor(() => expect(hook.result.current.error).toBeTruthy());
    expect(getCredits.mock.calls.map(([options]) => options.page)).toEqual([1, 2]);
    expect(hook.result.current.summary.today.complete).toBe(false);
    const view = await render(<NodeSeekCreditsScreen {...hook.result.current} />);
    expect(view.getByText('网络失败')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('重试加载更多'));
    await waitFor(() => expect(hook.result.current.busy).toBe(true));
    await view.rerender(<NodeSeekCreditsScreen {...hook.result.current} />);
    expect(view.getByLabelText('读取中').props.accessibilityState.disabled).toBe(true);
    expect(view.getByText('签到收益统计中')).toBeTruthy();
    expect(view.queryByLabelText('重试加载更多')).toBeNull();
    expect(view.getByText('余额 105')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('读取中'));
    expect(getCredits).toHaveBeenCalledTimes(3);
    await act(async () => finishRetry?.(page(2, [entry(2), entry(1, 1)])));
    await waitFor(() => expect(hook.result.current.summary.today.complete).toBe(true));
    expect(getCredits.mock.calls.map(([options]) => options.page)).toEqual([1, 2, 2]);
    expect(hook.result.current.summary.today.income).toBe(7);
    await view.rerender(<NodeSeekCreditsScreen {...hook.result.current} />);
    expect(view.getByLabelText('加载更多流水').props.accessibilityState.disabled).toBe(false);
    expect(view.queryByText('网络失败')).toBeNull();
  });

  it('restarts refresh at page one and never combines the old next page with new records', async () => {
    const getCredits = jest
      .fn<NodeSeekCreditsGateway['getNodeSeekCredits']>()
      .mockResolvedValueOnce(page(1, [entry(5)]))
      .mockResolvedValueOnce(page(2, [entry(4), entry(1, 1)]))
      .mockResolvedValueOnce(page(1, [entry(99)], false));
    const hook = await controller(getCredits);
    await waitFor(() => expect(hook.result.current.summary.today.complete).toBe(true));
    expect(hook.result.current.summary.today.income).toBe(9);
    await act(async () => hook.result.current.refresh());
    await waitFor(() => expect(hook.result.current.summary.today.income).toBe(99));
    expect(getCredits.mock.calls.map(([options]) => options.page)).toEqual([1, 2, 1]);
    const key = forumQueryKeys.accountData({
      source: 'nodeseek',
      kind: 'credits',
      userId: '42',
      sessionEpoch: 0,
      readPlanScope: 'authenticated:0'
    });
    expect(hook.client.getQueryData<InfiniteData<NodeSeekCreditPage>>(key)?.pages).toHaveLength(1);
    expect(hook.getAttendance).not.toHaveBeenCalled();
  });

  it('does not resume an old page chain when refreshing page one fails', async () => {
    const getCredits = jest
      .fn<NodeSeekCreditsGateway['getNodeSeekCredits']>()
      .mockResolvedValueOnce(page(1, [entry(5)]))
      .mockResolvedValueOnce(page(2, [entry(4), entry(1, 1)]))
      .mockRejectedValueOnce(new Error('刷新失败'));
    const hook = await controller(getCredits);
    await waitFor(() => expect(hook.result.current.summary.today.complete).toBe(true));
    await act(async () => hook.result.current.refresh());
    await waitFor(() => expect(hook.result.current.error).toBeTruthy());
    expect(hook.result.current.summary.today.complete).toBe(false);
    expect(getCredits.mock.calls.map(([options]) => options.page)).toEqual([1, 2, 1]);
  });

  it('does not read while inactive and cancels stale identity requests', async () => {
    let finishOld: ((value: NodeSeekCreditPage) => void) | undefined;
    const oldPage = new Promise<NodeSeekCreditPage>((resolve) => {
      finishOld = resolve;
    });
    let oldSignal: AbortSignal | undefined;
    const getCredits = jest.fn<NodeSeekCreditsGateway['getNodeSeekCredits']>(({ userId, signal }) => {
      if (userId === '42') {
        oldSignal = signal;
        return oldPage;
      }
      return Promise.resolve(page(1, [entry(7)], false, userId));
    });
    const hook = await controller(getCredits, false);
    expect(getCredits).not.toHaveBeenCalled();
    expect(hook.getAttendance).not.toHaveBeenCalled();
    await hook.rerender({ active: true, userId: '42', sessionEpoch: 0 });
    await waitFor(() => expect(getCredits).toHaveBeenCalledTimes(1));
    await hook.rerender({ active: true, userId: '43', sessionEpoch: 1 });
    await waitFor(() => expect(hook.result.current.summary.today.income).toBe(7));
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => finishOld?.(page(1, [entry(999)], false)));
    expect(hook.result.current.summary.today.income).toBe(7);
  });

  it('does not present zero totals as known before reading or for an incomplete boundary day', async () => {
    const common = {
      currency: 'coin' as const,
      error: null,
      busy: false,
      refreshing: false,
      loaded: false,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(async () => undefined)
    };
    const view = await render(
      <NodeSeekCreditsScreen {...common} summary={summarizeCredits({ entries: [], loaded: false, hasMore: false })} />
    );
    expect(view.getByTestId('credits-today-summary').props.children).toBe('待补齐');
    expect(view.queryByText('收入 0 · 支出 0 · 净变化 0')).toBeNull();
    await view.rerender(
      <NodeSeekCreditsScreen
        {...common}
        loaded
        hasMore
        summary={summarizeCredits({ entries: [entry(5), entry(1, 1)], loaded: true, hasMore: true })}
      />
    );
    expect(view.getByText('当日记录待补齐')).toBeTruthy();
    expect(view.queryByText('收入 1 · 支出 0 · 净变化 +1')).toBeNull();
    expect(view.getByText('余额 105')).toBeTruthy();
  });
});

describe('NodeSeek stardust ledger', () => {
  function starPage(entries: NodeSeekCreditEntry[], nextBeforeId: number | null = null): NodeSeekStardustCreditPage {
    return { source: 'nodeseek', userId: '42', entries, hasMore: nextBeforeId !== null, nextBeforeId };
  }

  it('uses star cursors and a separate cache, reads no chicken ledger or attendance, and resets refresh', async () => {
    const getCoin = jest.fn<NodeSeekCreditsGateway['getNodeSeekCredits']>();
    const getStar = jest
      .fn<NodeSeekCreditsGateway['getNodeSeekStardustCredits']>()
      .mockResolvedValueOnce(starPage([entry(1, 0, '点赞')], 100))
      .mockResolvedValueOnce(starPage([entry(-2, 0, '转账'), entry(1, 1, '点赞')], 90))
      .mockResolvedValueOnce(starPage([entry(4, 0, '系统')]));
    const hook = await controller(getCoin, true, 'stardust', getStar);
    await waitFor(() => expect(hook.result.current.summary.today.complete).toBe(true));
    expect(getStar.mock.calls.map(([options]) => options.beforeId)).toEqual([undefined, 100]);
    expect(hook.result.current.summary.today).toMatchObject({ income: 1, expense: 2, net: -1 });
    expect(getCoin).not.toHaveBeenCalled();
    expect(hook.getAttendance).not.toHaveBeenCalled();
    const view = await render(<NodeSeekCreditsScreen {...hook.result.current} />);
    expect(view.getByText('转账')).toBeTruthy();
    expect(view.queryByText(/签到/)).toBeNull();
    await act(async () => hook.result.current.refresh());
    await waitFor(() => expect(hook.result.current.summary.today.net).toBe(4));
    expect(getStar.mock.calls.map(([options]) => options.beforeId)).toEqual([undefined, 100, undefined]);
    expect(hook.getAttendance).not.toHaveBeenCalled();
    const key = forumQueryKeys.accountData({
      source: 'nodeseek',
      kind: 'stardust-credits',
      userId: '42',
      sessionEpoch: 0,
      readPlanScope: 'authenticated:0'
    });
    expect(hook.client.getQueryData<InfiniteData<NodeSeekStardustCreditPage>>(key)?.pages).toHaveLength(1);
    expect(
      hook.client.getQueryData(
        forumQueryKeys.accountData({
          source: 'nodeseek',
          kind: 'credits',
          userId: '42',
          sessionEpoch: 0,
          readPlanScope: 'authenticated:0'
        })
      )
    ).toBeUndefined();
  });

  it('shows a complete zero for an empty star ledger without attendance text', async () => {
    const getStar = jest.fn<NodeSeekCreditsGateway['getNodeSeekStardustCredits']>().mockResolvedValue(starPage([]));
    const hook = await controller(jest.fn<NodeSeekCreditsGateway['getNodeSeekCredits']>(), true, 'stardust', getStar);
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    const view = await render(<NodeSeekCreditsScreen {...hook.result.current} />);
    expect(view.getByText('暂无星辰流水')).toBeTruthy();
    expect(view.queryByText(/签到/)).toBeNull();
    expect(hook.result.current.summary.today).toMatchObject({ complete: true, net: 0 });
  });

  it('cancels a departing star read and never puts its late amounts into the chicken ledger', async () => {
    let finishStar: ((value: NodeSeekStardustCreditPage) => void) | undefined;
    let starSignal: AbortSignal | undefined;
    const oldStar = new Promise<NodeSeekStardustCreditPage>((resolve) => {
      finishStar = resolve;
    });
    const getStar = jest.fn<NodeSeekCreditsGateway['getNodeSeekStardustCredits']>(({ signal }) => {
      starSignal = signal;
      return oldStar;
    });
    const getCoin = jest
      .fn<NodeSeekCreditsGateway['getNodeSeekCredits']>()
      .mockResolvedValue(page(1, [entry(3)], false));
    const hook = await controller(getCoin, true, 'stardust', getStar);
    await waitFor(() => expect(getStar).toHaveBeenCalledTimes(1));
    await hook.rerender({ active: true, userId: '42', sessionEpoch: 0, currency: 'coin' });
    await waitFor(() => expect(hook.result.current.summary.today.income).toBe(3));
    expect(starSignal?.aborted).toBe(true);
    await act(async () => finishStar?.(starPage([entry(999)])));
    expect(hook.result.current.summary.today.income).toBe(3);
    expect(hook.getAttendance).not.toHaveBeenCalled();
  });
});
