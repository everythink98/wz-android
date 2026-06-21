import type { MutableRefObject } from 'react';
import {
  beginOptimisticAction,
  completeOptimisticAction,
  type OptimisticActionState
} from '../topicActionState';
import { clearLinuxDoAccess, clearLinuxDoAccessForGeneration, parseLinuxDoDocumentCookie, summarizeLinuxDoCookies } from '../linuxdoCookieBridge';
import { errorMessage } from '../appUtils';
import type { SiteSessionEvent } from '../siteSessionState';

export function isNodeSeekLoginRequiredError(error: unknown) {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as { source?: unknown }).source === 'nodeseek'
    && (error as { loginRequired?: unknown }).loginRequired
  );
}

export async function clearExpiredLinuxDoLogin({
  error,
  generation,
  resetLinuxDoLevelState,
  updateLinuxDoSession
}: {
  error: unknown;
  generation?: number;
  resetLinuxDoLevelState: () => void;
  updateLinuxDoSession: (event: SiteSessionEvent) => void;
}) {
  const remainingAccess = generation === undefined
    ? await clearLinuxDoAccess()
    : await clearLinuxDoAccessForGeneration(generation);
  const remainingCookies = parseLinuxDoDocumentCookie(remainingAccess?.cookieHeader || '');
  const remainingSummary = summarizeLinuxDoCookies(remainingCookies);
  updateLinuxDoSession(remainingAccess?.cookieHeader
    ? { type: 'verification-succeeded', cookieSummary: remainingSummary.names, loggedIn: false, at: new Date().toISOString() }
    : { type: 'login-expired', message: errorMessage(error) });
  resetLinuxDoLevelState();
}

export async function runOptimisticActionQueue<RequestOwnerValue>({
  applyDisplayed,
  isCurrentRequest,
  key,
  notify,
  optimisticActions,
  requestOwner,
  sendDesired,
  setOptimisticActionState,
  successMessage
}: {
  applyDisplayed: (desiredActive: boolean) => void;
  isCurrentRequest: (requestOwner: RequestOwnerValue) => boolean;
  key: string;
  notify: (message: string) => void;
  optimisticActions: MutableRefObject<Record<string, OptimisticActionState>>;
  requestOwner: RequestOwnerValue;
  sendDesired: (desiredActive: boolean) => Promise<boolean>;
  setOptimisticActionState: (key: string, state?: OptimisticActionState) => void;
  successMessage: (active: boolean) => string;
}) {
  while (true) {
    const state = optimisticActions.current[key];
    if (!state?.inFlight || typeof state.inFlightTarget !== 'boolean') {
      return;
    }
    const desiredActive = state.inFlightTarget;
    let succeeded = false;
    try {
      succeeded = await sendDesired(desiredActive);
    } catch (error) {
      if (isCurrentRequest(requestOwner)) {
        notify(`${errorMessage(error)}，已恢复原状态。`);
      }
    }
    if (!isCurrentRequest(requestOwner)) {
      setOptimisticActionState(key);
      return;
    }
    const latest = optimisticActions.current[key];
    if (!latest) {
      return;
    }
    const completed = completeOptimisticAction(latest, succeeded);
    setOptimisticActionState(key, completed.state);
    if (!succeeded) {
      applyDisplayed(completed.state.displayed);
      return;
    }
    if (!completed.request) {
      applyDisplayed(completed.state.confirmed);
      notify(successMessage(completed.state.confirmed));
      return;
    }
  }
}

export function beginOptimisticTopicAction<RequestOwnerValue>({
  applyDisplayed,
  currentActive,
  isCurrentRequest,
  key,
  optimisticActions,
  requestOwner,
  setOptimisticActionState,
  startQueue
}: {
  applyDisplayed: (desiredActive: boolean) => void;
  currentActive: boolean;
  isCurrentRequest: (requestOwner: RequestOwnerValue) => boolean;
  key: string;
  optimisticActions: MutableRefObject<Record<string, OptimisticActionState>>;
  requestOwner: RequestOwnerValue;
  setOptimisticActionState: (key: string, state?: OptimisticActionState) => void;
  startQueue: () => void;
}) {
  if (!isCurrentRequest(requestOwner)) {
    return;
  }
  const transition = beginOptimisticAction(optimisticActions.current[key], currentActive);
  setOptimisticActionState(key, transition.state);
  if (!isCurrentRequest(requestOwner)) {
    setOptimisticActionState(key);
    return;
  }
  applyDisplayed(transition.state.displayed);
  if (transition.request) {
    startQueue();
  }
}
