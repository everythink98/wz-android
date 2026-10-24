import { describe, expect, it, jest } from '@jest/globals';
import type { ComponentProps } from 'react';
import { LinuxDoCreditError, type LinuxDoCreditAccount, type LinuxDoCreditEntry } from '@/domain/forum/linuxDoCredit';
import { formatDateTime } from '@/domain/forum/presentation';
import { LinuxDoCreditScreen } from '@/features/more/LinuxDoCreditScreen';
import { LinuxDoCreditSummary } from '@/features/more/components/LinuxDoCreditSummary';
import { fireEvent, render } from '../render';

const account: LinuxDoCreditAccount = {
  userId: '42',
  username: 'reader',
  availableBalance: '9007199254740993.01',
  pendingBalance: '2.50'
};

function entry(overrides: Partial<LinuxDoCreditEntry> = {}): LinuxDoCreditEntry {
  return {
    id: '1',
    title: '社区分数划转',
    amount: '12.34',
    direction: 'income',
    type: 'community',
    status: 'success',
    createdAt: '2026-10-22T03:04:00Z',
    counterparty: '',
    settlementPending: false,
    ...overrides
  };
}

function summaryProps(): ComponentProps<typeof LinuxDoCreditSummary> {
  return {
    account,
    busy: false,
    error: undefined,
    onOpen: jest.fn(),
    onConnect: jest.fn(),
    onRefresh: jest.fn()
  };
}

function screenProps(): ComponentProps<typeof LinuxDoCreditScreen> {
  return {
    account,
    entries: [entry()],
    busy: false,
    refreshing: false,
    loaded: true,
    hasMore: false,
    error: undefined,
    onLoadMore: jest.fn(),
    onRefresh: jest.fn(),
    onConnect: jest.fn()
  };
}

describe('LDC balance summary', () => {
  it('keeps an exact large balance and opens records without a duplicate refresh control', async () => {
    const props = summaryProps();
    const view = await render(<LinuxDoCreditSummary {...props} />);
    expect(view.getByText('9,007,199,254,740,993.01')).toBeTruthy();
    expect(view.getByText('待到账 2.50 LDC')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'LDC 可用余额 9,007,199,254,740,993.01' }));
    expect(props.onOpen).toHaveBeenCalledTimes(1);
    expect(props.onRefresh).not.toHaveBeenCalled();
    expect(view.queryByRole('button', { name: '刷新 LDC 余额' })).toBeNull();
    expect(props.onConnect).not.toHaveBeenCalled();
  });

  it('does not turn loading or an unread balance failure into zero', async () => {
    const props = summaryProps();
    const view = await render(<LinuxDoCreditSummary {...props} account={undefined} busy />);
    expect(view.getByText('读取余额中')).toBeTruthy();
    expect(view.getByText('—')).toBeTruthy();
    expect(view.queryByRole('button', { name: '连接 LDC' })).toBeNull();
    await view.rerender(<LinuxDoCreditSummary {...props} account={undefined} error={new Error('网络连接失败')} />);
    expect(view.getByText('网络连接失败')).toBeTruthy();
    expect(view.queryByText('0.00')).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: '重试读取余额' }));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    await view.rerender(<LinuxDoCreditSummary {...props} account={undefined} />);
    await fireEvent.press(view.getByRole('button', { name: '连接 LDC' }));
    expect(props.onConnect).toHaveBeenCalledTimes(1);
  });

  it('retains the cached balance after a read failure and offers a targeted retry', async () => {
    const props = summaryProps();
    const view = await render(<LinuxDoCreditSummary {...props} error={new Error('网络连接失败')} />);
    expect(view.getByText('9,007,199,254,740,993.01')).toBeTruthy();
    expect(view.getByText('显示上次读取的余额')).toBeTruthy();
    expect(view.getByText('网络连接失败')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: '重试读取余额' }));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    expect(props.onConnect).not.toHaveBeenCalled();
  });

  it.each<{ kind: LinuxDoCreditError['kind']; label: string }>([
    { kind: 'authorization-required', label: '连接 LDC' },
    { kind: 'identity-mismatch', label: '重新连接 LDC' }
  ])('hides a cached account for $kind and offers the matching connection action', async ({ kind, label }) => {
    const props = summaryProps();
    const view = await render(
      <LinuxDoCreditSummary {...props} error={new LinuxDoCreditError(kind, '请连接当前账号')} />
    );
    expect(view.queryByText('9,007,199,254,740,993.01')).toBeNull();
    expect(view.queryByText('待到账 2.50 LDC')).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: label }));
    expect(props.onConnect).toHaveBeenCalledTimes(1);
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it('retains the last balance with a verification notice and an explicit web action', async () => {
    const props = summaryProps();
    const view = await render(
      <LinuxDoCreditSummary {...props} error={new LinuxDoCreditError('verification-required', 'LDC 需要网页验证')} />
    );
    expect(view.getByText('9,007,199,254,740,993.01')).toBeTruthy();
    expect(view.getByText('显示上次读取的余额')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: '验证 LDC' }));
    expect(props.onConnect).toHaveBeenCalledTimes(1);
  });

  it('offers forum verification in both views when the forum session needs a web check', async () => {
    const summary = summaryProps();
    const error = new Error('L 站需要网页验证');
    const view = await render(<LinuxDoCreditSummary {...summary} error={error} forumVerificationRequired />);
    expect(view.queryByRole('button', { name: '验证 LDC' })).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: '验证 L 站' }));
    expect(summary.onConnect).toHaveBeenCalledTimes(1);
    expect(summary.onRefresh).not.toHaveBeenCalled();

    const screen = screenProps();
    await view.rerender(<LinuxDoCreditScreen {...screen} error={error} forumVerificationRequired hasMore />);
    expect(view.queryByRole('button', { name: '验证 LDC' })).toBeNull();
    expect(view.getByRole('button', { name: '重试加载更多' })).toBeDisabled();
    await fireEvent.press(view.getByRole('button', { name: '验证 L 站' }));
    expect(screen.onConnect).toHaveBeenCalledTimes(1);
    expect(screen.onRefresh).not.toHaveBeenCalled();
  });
});

describe('LDC read-only records', () => {
  it('shows the supplied transaction direction, exact amount, state, source and pending settlement', async () => {
    const props = screenProps();
    const view = await render(
      <LinuxDoCreditScreen
        {...props}
        entries={[
          entry({ settlementPending: true, type: 'receive', counterparty: 'merchant' }),
          entry({ id: '2', title: '社区分数扣减', amount: '-0.10', direction: 'expense' }),
          entry({
            id: '3',
            title: '退回订单',
            amount: '5.00',
            type: 'payment',
            status: 'refund',
            direction: 'neutral'
          }),
          entry({ id: '4', title: '失败订单', amount: '6.00', type: 'payment', status: 'failed', direction: 'neutral' })
        ]}
      />
    );
    expect(view.getByText('9,007,199,254,740,993.01')).toBeTruthy();
    expect(view.getByText('单位：LDC')).toBeTruthy();
    expect(view.getByLabelText('收入 +12.34 LDC')).toHaveTextContent('+12.34');
    expect(view.getByText('已完成 · 待到账')).toBeTruthy();
    expect(view.getByText('商户收入 · 对方 merchant')).toBeTruthy();
    expect(view.getByLabelText('支出 -0.10 LDC')).toHaveTextContent('-0.10');
    expect(view.getByLabelText('金额 5.00 LDC')).toHaveTextContent('5.00');
    expect(view.getByText('已退款')).toBeTruthy();
    expect(view.getByLabelText('金额 6.00 LDC')).toHaveTextContent('6.00');
    expect(view.getByText('失败')).toBeTruthy();
    expect(view.getAllByText(formatDateTime('2026-10-22T03:04:00Z'))).toHaveLength(4);
    expect(view.queryByLabelText('收入 +5.00 LDC')).toBeNull();
    expect(view.queryByLabelText('支出 -6.00 LDC')).toBeNull();
    expect(view.queryByRole('button', { name: '转账' })).toBeNull();
  });

  it('preserves rows during refresh, exposes pagination and prevents duplicate loading', async () => {
    const props = screenProps();
    const view = await render(<LinuxDoCreditScreen {...props} hasMore />);
    await fireEvent(view.getByTestId('linuxdo-credit-list'), 'refresh');
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByRole('button', { name: '加载更多记录' }));
    expect(props.onLoadMore).toHaveBeenCalledTimes(1);
    await view.rerender(<LinuxDoCreditScreen {...props} hasMore busy refreshing />);
    expect(view.getByText('社区分数划转')).toBeTruthy();
    expect(view.getByRole('button', { name: '读取中' })).toBeDisabled();
    await fireEvent.press(view.getByRole('button', { name: '读取中' }));
    expect(props.onLoadMore).toHaveBeenCalledTimes(1);
    await view.rerender(<LinuxDoCreditScreen {...props} hasMore error={new Error('下一页读取失败')} />);
    expect(view.getByText('社区分数划转')).toBeTruthy();
    expect(view.queryByText('没有更多了')).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: '重试加载更多' }));
    expect(props.onLoadMore).toHaveBeenCalledTimes(2);
  });

  it('distinguishes initial loading, failure and a successfully empty list', async () => {
    const props = screenProps();
    const view = await render(<LinuxDoCreditScreen {...props} account={undefined} entries={[]} busy loaded={false} />);
    expect(view.getByRole('status', { name: '读取 LDC 记录中' })).toBeTruthy();
    expect(view.queryByText('暂无收支记录')).toBeNull();
    await view.rerender(
      <LinuxDoCreditScreen {...props} entries={[]} loaded={false} error={new Error('读取失败，请重试')} />
    );
    expect(view.getByText('读取失败，请重试')).toBeTruthy();
    expect(view.queryByText('暂无收支记录')).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: '重试读取' }));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    await view.rerender(<LinuxDoCreditScreen {...props} entries={[]} />);
    expect(view.getByText('暂无收支记录')).toBeTruthy();
  });

  it('hides stale balance and records after an account mismatch and reconnects instead of paginating', async () => {
    const props = screenProps();
    const view = await render(
      <LinuxDoCreditScreen
        {...props}
        hasMore
        error={new LinuxDoCreditError('identity-mismatch', 'LDC 账号与当前账号不一致')}
      />
    );
    expect(view.queryByText('社区分数划转')).toBeNull();
    expect(view.queryByText('9,007,199,254,740,993.01')).toBeNull();
    expect(view.queryByRole('button', { name: '加载更多记录' })).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: '重新连接 LDC' }));
    expect(props.onConnect).toHaveBeenCalledTimes(1);
    expect(props.onRefresh).not.toHaveBeenCalled();
  });
});
