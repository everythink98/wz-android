import type { LinuxDoReadingRecovery, LinuxDoReadResumeOutcome } from '@/domain/session/sessionContracts';

export type ReadRecovery = {
  queryKey: readonly unknown[];
  // A new user request may retry an error whose automatic prompt was dismissed.
  explicit?: true;
  // Explicit reads may have no automatically enabled Query observer.
  isCurrent?: () => boolean;
  // The local owner is responsible for canceling its read when provided.
  cancel?: () => void;
  resume: (signal?: AbortSignal) => Promise<LinuxDoReadResumeOutcome>;
};

export type LinuxDoVerificationRecovery = ReadRecovery | LinuxDoReadingRecovery;
