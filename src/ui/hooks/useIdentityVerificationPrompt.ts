import { useEffect, useRef } from 'react';
import type { SourceErrorInfo } from '@/domain/forum/models';

export function useIdentityVerificationPrompt({
  enabled = true,
  error,
  identityPending,
  intentKey,
  showVerification
}: {
  enabled?: boolean;
  error?: SourceErrorInfo;
  identityPending: boolean;
  intentKey: string | null;
  showVerification: (message?: string) => unknown;
}) {
  const handledIntentRef = useRef<string | null>(null);
  useEffect(() => {
    if (!identityPending || !intentKey) {
      handledIntentRef.current = null;
      return;
    }
    if (!enabled) {
      handledIntentRef.current = intentKey;
      return;
    }
    if (error?.kind !== 'verification-required' || handledIntentRef.current === intentKey) return;
    handledIntentRef.current = intentKey;
    void showVerification(error.message);
  }, [enabled, error, identityPending, intentKey, showVerification]);
}
