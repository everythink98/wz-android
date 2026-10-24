import { describe, expect, it } from 'vitest';
import { formatLinuxDoCreditAmount, linuxDoCreditStatusLabel } from './linuxDoCredit';

describe('LDC display', () => {
  it('formats large and fractional balances without losing decimal precision', () => {
    expect(formatLinuxDoCreditAmount('999999999999999999.99')).toBe('999,999,999,999,999,999.99');
    expect(formatLinuxDoCreditAmount('-1234.5')).toBe('-1,234.50');
    expect(formatLinuxDoCreditAmount('0')).toBe('0.00');
    expect(formatLinuxDoCreditAmount('0.01')).toBe('0.01');
  });

  it('distinguishes unpaid orders from completed, refunded and disputed orders', () => {
    expect(linuxDoCreditStatusLabel('pending')).toBe('待支付');
    expect(linuxDoCreditStatusLabel('success')).toBe('已完成');
    expect(linuxDoCreditStatusLabel('refund')).toBe('已退款');
    expect(linuxDoCreditStatusLabel('disputing')).toBe('争议处理中');
    expect(linuxDoCreditStatusLabel('refused')).toBe('退款被拒绝');
    expect(linuxDoCreditStatusLabel('new-status')).toBe('未知状态');
  });
});
