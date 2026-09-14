import type { SourceErrorInfo } from '@/domain/forum/models';
import type { SessionSource } from '@/domain/forum/sourceCatalog';
import type { SiteSessionState } from './siteSessionState';

export type CredentialSite = SessionSource;

export type RequestAccountRecheck = (
  source: SessionSource,
  requestSessionEpoch: number,
  parentTraceId?: string
) => void;

export type AccountReconcileResult =
  | { status: 'anonymous' | 'changed' | 'same'; session: SiteSessionState; partial?: boolean }
  | { status: 'stale' }
  | { status: 'unknown'; error: string; errorInfo: SourceErrorInfo };

export type LinuxDoReadResumeOutcome = 'completed' | 'failed' | 'verification-required' | 'stale';

export type LinuxDoReadingRecovery = {
  kind: 'reading';
  batchId: number;
  isCurrent: () => boolean;
  isExpired?: () => boolean;
  failureMessage?: string;
  resume: () => Promise<LinuxDoReadResumeOutcome>;
  cancel: () => void;
};

export type LinuxDoVerificationRecovery = LinuxDoReadRecovery | LinuxDoReadingRecovery;

export type LinuxDoReadRecovery = {
  queryKey: readonly unknown[];
  resume: () => Promise<LinuxDoReadResumeOutcome>;
};
