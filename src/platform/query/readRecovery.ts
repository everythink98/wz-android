import type { LinuxDoReadingRecovery, LinuxDoReadResumeOutcome } from '@/domain/session/sessionContracts';

export type ReadRecovery = {
  queryKey: readonly unknown[];
  // A new user request may retry an error whose automatic prompt was dismissed.
  explicit?: true;
  // An aggregate read and its per-source view can report the same block.
  dismissalGroup?: object;
  // Explicit reads may have no automatically enabled Query observer.
  isCurrent?: () => boolean;
  // The local owner is responsible for canceling its read when provided.
  cancel?: () => void;
  resume: (signal?: AbortSignal) => Promise<LinuxDoReadResumeOutcome>;
};

export type LinuxDoVerificationRecovery = ReadRecovery | LinuxDoReadingRecovery;

export type LinuxDoWebsiteVerification = { kind: 'website'; isCurrent: () => boolean };
export type LinuxDoVerificationRequest = LinuxDoVerificationRecovery | LinuxDoWebsiteVerification;
