import { useCallback, useRef, useState } from 'react';
import type { RequestDispatchState } from '@/platform/network/request';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

type Scope = { identityKey: string; itemId: string; replySessionEpoch: number };
type Operation =
  | { phase: 'idle' }
  | { phase: 'uploading' | 'confirmed'; controller: AbortController; scope: Scope }
  | {
      phase: 'sending';
      controller: AbortController;
      scope: Scope;
      content: string;
      dispatchState: RequestDispatchState;
    };
type Confirmation = {
  controller: AbortController;
  scope: Scope;
  completed: Promise<void>;
  complete: () => void;
  fail: (error: unknown) => void;
};

export function useNotificationReplyOperation(getScope: () => Scope & { canAccessSource: boolean }) {
  const getScopeRef = useCommittedRef(getScope);
  const operation = useRef<Operation>({ phase: 'idle' });
  const confirmation = useRef<Confirmation | null>(null);
  const uncertain = useRef(new Set<string>());
  const [snapshot, setSnapshot] = useState(operation.current);
  const publish = useCallback((next: Operation) => {
    operation.current = next;
    setSnapshot(next);
  }, []);
  const scopeCurrent = useCallback(
    (scope: Scope) => {
      const current = getScopeRef.current();
      return (
        current.canAccessSource &&
        current.identityKey === scope.identityKey &&
        current.itemId === scope.itemId &&
        current.replySessionEpoch === scope.replySessionEpoch
      );
    },
    [getScopeRef]
  );
  const hasOperation = useCallback(() => operation.current.phase !== 'idle', []);
  const isSending = useCallback(() => operation.current.phase === 'sending', []);
  const owns = useCallback(
    (controller: AbortController) => {
      const current = operation.current;
      return (
        current.phase !== 'idle' &&
        current.controller === controller &&
        !controller.signal.aborted &&
        scopeCurrent(current.scope)
      );
    },
    [scopeCurrent]
  );
  const beginSend = useCallback(
    (content: string, scope: Scope) => {
      if (operation.current.phase !== 'idle' || !scopeCurrent(scope)) return null;
      const controller = new AbortController();
      const dispatchState: RequestDispatchState = { mayHaveSent: false };
      publish({ phase: 'sending', controller, content, dispatchState, scope });
      return { controller, dispatchState };
    },
    [publish, scopeCurrent]
  );
  const beginUpload = useCallback(
    (scope: Scope) => {
      if (operation.current.phase !== 'idle' || !scopeCurrent(scope)) return null;
      const controller = new AbortController();
      publish({ phase: 'uploading', controller, scope });
      return { controller };
    },
    [publish, scopeCurrent]
  );
  const confirmed = useCallback(
    (controller: AbortController, content: string) => {
      const current = operation.current;
      if (current.phase === 'idle' || !owns(controller)) return;
      uncertain.current.delete(content);
      publish({ phase: 'confirmed', controller, scope: current.scope });
    },
    [owns, publish]
  );
  const finish = useCallback(
    (controller: AbortController) => {
      const current = operation.current;
      if (current.phase !== 'idle' && current.controller === controller) publish({ phase: 'idle' });
    },
    [publish]
  );
  const markUncertain = useCallback((content: string) => {
    uncertain.current.add(content);
  }, []);
  const isUncertain = useCallback((content: string) => uncertain.current.has(content), []);
  const forgetUncertain = useCallback(() => {
    uncertain.current.clear();
  }, []);
  const cancelConfirmation = useCallback(() => {
    const current = confirmation.current;
    confirmation.current = null;
    current?.controller.abort();
    current?.complete();
  }, []);
  const beginConfirmation = useCallback(() => {
    if (confirmation.current) return null;
    const scope = getScopeRef.current();
    if (!scope.canAccessSource) return null;
    const controller = new AbortController();
    let complete!: () => void;
    let fail!: (error: unknown) => void;
    const completed = new Promise<void>((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });
    const request: Confirmation = { controller, scope, completed, complete, fail };
    confirmation.current = request;
    return request;
  }, [getScopeRef]);
  const consumeConfirmation = useCallback(
    (request: Confirmation) => {
      const current = confirmation.current;
      if (current !== request || request.controller.signal.aborted) return false;
      confirmation.current = null;
      request.controller.abort();
      const allowed = scopeCurrent(request.scope);
      if (!allowed) request.complete();
      return allowed;
    },
    [scopeCurrent]
  );
  const cancel = useCallback(() => {
    const current = operation.current;
    if (current.phase === 'sending' && current.dispatchState.mayHaveSent) uncertain.current.add(current.content);
    if (current.phase !== 'idle') {
      current.controller.abort();
      publish({ phase: 'idle' });
    }
    cancelConfirmation();
  }, [cancelConfirmation, publish]);
  return {
    busy: snapshot.phase !== 'idle',
    hasOperation,
    isSending,
    owns,
    beginSend,
    beginUpload,
    confirmed,
    finish,
    markUncertain,
    isUncertain,
    forgetUncertain,
    beginConfirmation,
    consumeConfirmation,
    cancelConfirmation,
    cancel
  };
}
