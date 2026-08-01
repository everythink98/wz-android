import type { QueryKey } from '@tanstack/react-query';
import type { SourceErrorInfo } from '@/domain/forum/models';
import type { SiteSessionState } from '@/domain/session/siteSessionState';

export type AccountReconcileResult =
  | { status: 'anonymous' | 'changed' | 'same'; session: SiteSessionState; partial?: boolean }
  | { status: 'stale' }
  | { status: 'unknown'; error: string; errorInfo: SourceErrorInfo };

export type LinuxDoReadResumeOutcome = 'completed' | 'failed' | 'verification-required' | 'stale';

export type LinuxDoReadRecovery = {
  queryKey: QueryKey;
  resume: () => Promise<LinuxDoReadResumeOutcome>;
};
