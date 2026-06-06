export type VerificationFlowResult =
  | {
    status: 'success';
    retryOriginalRequest: true;
    cookieSummary?: string[];
  }
  | {
    status: 'closed';
    retryOriginalRequest: false;
    message?: string;
  }
  | {
    status: 'failed';
    retryOriginalRequest: false;
    message?: string;
  }
  | {
    status: 'stale';
    retryOriginalRequest: false;
  };

export function verificationFlowFailed(message?: string): VerificationFlowResult {
  return {
    status: 'failed',
    retryOriginalRequest: false,
    ...(message ? { message } : {})
  };
}

export function verificationFlowStale(): VerificationFlowResult {
  return {
    status: 'stale',
    retryOriginalRequest: false
  };
}

export function isFinalVerificationFlowResult(result: VerificationFlowResult) {
  return result.status !== 'stale';
}

export type VerificationSessionTracker = {
  current: () => number;
  start: () => number;
  close: (sessionId: number) => VerificationFlowResult;
  isCurrent: (sessionId: number) => boolean;
  resultFor: (sessionId: number, result: VerificationFlowResult) => VerificationFlowResult;
};

export function createVerificationSessionTracker(initialSessionId = 0): VerificationSessionTracker {
  let currentSessionId = initialSessionId;
  let activeSessionId: number | null = null;
  return {
    current: () => currentSessionId,
    start: () => {
      currentSessionId += 1;
      activeSessionId = currentSessionId;
      return currentSessionId;
    },
    close: (sessionId: number) => {
      if (activeSessionId === sessionId) {
        activeSessionId = null;
      }
      return {
        status: 'closed',
        retryOriginalRequest: false
      };
    },
    isCurrent: (sessionId: number) => activeSessionId === sessionId && currentSessionId === sessionId,
    resultFor: (sessionId: number, result: VerificationFlowResult) => (
      activeSessionId === sessionId && currentSessionId === sessionId ? result : verificationFlowStale()
    )
  };
}
