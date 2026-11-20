import { useCallback, useRef, useState } from 'react';

type Operation = { kind: 'travel' | 'submitting' };

export function useTopicComposerOperation(isMounted: React.RefObject<boolean>) {
  const current = useRef<Operation | null>(null);
  const [busy, setBusy] = useState(false);
  const isIdle = useCallback(() => current.current === null, []);
  const isSubmitting = useCallback(() => current.current?.kind === 'submitting', []);
  const begin = useCallback(
    (kind: Operation['kind']) => {
      if (current.current) return null;
      const run = { kind };
      current.current = run;
      if (kind === 'submitting' && isMounted.current) setBusy(true);
      return run;
    },
    [isMounted]
  );
  const release = useCallback(
    (run: Operation) => {
      if (current.current !== run) return;
      current.current = null;
      if (run.kind === 'submitting' && isMounted.current) setBusy(false);
    },
    [isMounted]
  );
  return { busy, isIdle, isSubmitting, begin, release };
}
