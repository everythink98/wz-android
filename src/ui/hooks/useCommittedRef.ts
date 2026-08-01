import { useLayoutEffect, useRef } from 'react';

export function useCommitRefValue<T>(ref: { current: T }, value: T) {
  useLayoutEffect(() => {
    ref.current = value;
  }, [ref, value]);
}

export function useCommittedRef<T>(value: T) {
  const ref = useRef(value);
  useCommitRefValue(ref, value);
  return ref;
}
