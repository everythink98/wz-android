export interface LinuxDoCreditAccount {
  userId: string;
  username: string;
  availableBalance: string;
  pendingBalance: string;
}

export interface LinuxDoCreditEntry {
  id: string;
  title: string;
  amount: string;
  direction: 'income' | 'expense' | 'neutral';
  status: string;
  type: string;
  createdAt: string;
  counterparty: string;
  settlementPending: boolean;
}

export interface LinuxDoCreditPage {
  userId: string;
  entries: LinuxDoCreditEntry[];
  page: number;
  total: number;
  nextPage: number | null;
}

export class LinuxDoCreditError extends Error {
  readonly name = 'LinuxDoCreditError';

  constructor(
    readonly kind: 'authorization-required' | 'identity-mismatch' | 'verification-required' | 'unavailable',
    message: string
  ) {
    super(message);
  }
}

export function formatLinuxDoCreditAmount(amount: string): string {
  const [integer, fraction = ''] = amount.split('.');
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.padEnd(2, '0')}`;
}

export function linuxDoCreditStatusLabel(status: string): string {
  switch (status) {
    case 'success':
      return '已完成';
    case 'pending':
      return '待支付';
    case 'failed':
      return '失败';
    case 'expired':
      return '已过期';
    case 'disputing':
      return '争议处理中';
    case 'refund':
      return '已退款';
    case 'refused':
      return '退款被拒绝';
    default:
      return '未知状态';
  }
}
