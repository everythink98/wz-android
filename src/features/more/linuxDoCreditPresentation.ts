import { LinuxDoCreditError, type LinuxDoCreditAccount } from '@/domain/forum/linuxDoCredit';

export function linuxDoCreditPresentation(
  account: LinuxDoCreditAccount | undefined,
  error: unknown,
  forumVerificationRequired: boolean
) {
  const accessError = error instanceof LinuxDoCreditError ? error.kind : undefined;
  const needsConnection = accessError === 'authorization-required' || accessError === 'identity-mismatch';
  const visibleAccount = needsConnection ? undefined : account;
  const webAction = forumVerificationRequired || needsConnection || accessError === 'verification-required';
  const connectLabel = forumVerificationRequired
    ? '验证 L 站'
    : accessError === 'identity-mismatch'
      ? '重新连接 LDC'
      : accessError === 'verification-required'
        ? '验证 LDC'
        : '连接 LDC';
  return { needsConnection, visibleAccount, webAction, connectLabel };
}
