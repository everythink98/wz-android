import type { MutableRefObject } from 'react';
import {
  beginOptimisticAction,
  completeOptimisticAction,
  type OptimisticActionState
} from '../topicActionState';
import { clearLinuxDoAccess, clearLinuxDoAccessForGeneration, parseLinuxDoDocumentCookie, summarizeLinuxDoCookies } from '../linuxdoCookieBridge';
import { errorMessage } from '../appUtils';
import type { SiteSessionEvent } from '../siteSessionState';

function isOptimisticActionOwner(state: OptimisticActionState | undefined, ownerKey: string | undefined) {
  return Boolean(state && (!ownerKey || state.ownerKey === ownerKey));
}

function optimisticActionStateForOwner(state: OptimisticActionState, ownerKey: string | undefined) {
  return ownerKey ? { ...state, ownerKey } : state;
}

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
  cookieHeader,
  resetLinuxDoLevelState,
  updateLinuxDoSession
}: {
  error: unknown;
  generation?: number;
  cookieHeader?: string;
  resetLinuxDoLevelState: () => void;
  updateLinuxDoSession: (event: SiteSessionEvent) => void;
}) {
  const remainingAccess = generation === undefined
    ? await clearLinuxDoAccess()
    : await clearLinuxDoAccessForGeneration(generation, cookieHeader);
  const remainingCookies = parseLinuxDoDocumentCookie(remainingAccess?.cookieHeader || '');
  const remainingSummary = summarizeLinuxDoCookies(remainingCookies);
  updateLinuxDoSession(remainingAccess?.cookieHeader
    ? { type: 'cookie-loaded', cookieSummary: remainingSummary.names, hasVerification: remainingSummary.hasClearance, loggedIn: false, at: new Date().toISOString() }
    : { type: 'login-expired', message: errorMessage(error) });
  resetLinuxDoLevelState();
}

export async function runSingleTopicAction<T>({
  key,
  notifyDuplicate,
  pendingActions,
  task
}: {
  key: string;
  notifyDuplicate?: () => void;
  pendingActions: MutableRefObject<Record<string, true>>;
  task: () => Promise<T>;
}) {
  if (pendingActions.current[key]) {
    notifyDuplicate?.();
    return undefined;
  }
  pendingActions.current = { ...pendingActions.current, [key]: true };
  try {
    return await task();
  } finally {
    const next = { ...pendingActions.current };
    delete next[key];
    pendingActions.current = next;
  }
}

export async function runOptimisticActionQueue<RequestOwnerValue>({
  applyDisplayed,
  isCurrentRequest,
  key,
  notify,
  optimisticActions,
  ownerKey,
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
  ownerKey?: string;
  requestOwner: RequestOwnerValue;
  sendDesired: (desiredActive: boolean) => Promise<boolean>;
  setOptimisticActionState: (key: string, state?: OptimisticActionState) => void;
  successMessage: (active: boolean) => string;
}) {
  while (true) {
    const state = optimisticActions.current[key];
    if (!isOptimisticActionOwner(state, ownerKey) || !state?.inFlight || typeof state.inFlightTarget !== 'boolean') {
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
      if (isOptimisticActionOwner(optimisticActions.current[key], ownerKey)) {
        setOptimisticActionState(key);
      }
      return;
    }
    const latest = optimisticActions.current[key];
    if (!isOptimisticActionOwner(latest, ownerKey)) {
      return;
    }
    const completed = completeOptimisticAction(latest, succeeded);
    setOptimisticActionState(key, optimisticActionStateForOwner(completed.state, ownerKey));
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
  ownerKey,
  requestOwner,
  setOptimisticActionState,
  startQueue
}: {
  applyDisplayed: (desiredActive: boolean) => void;
  currentActive: boolean;
  isCurrentRequest: (requestOwner: RequestOwnerValue) => boolean;
  key: string;
  optimisticActions: MutableRefObject<Record<string, OptimisticActionState>>;
  ownerKey?: string;
  requestOwner: RequestOwnerValue;
  setOptimisticActionState: (key: string, state?: OptimisticActionState) => void;
  startQueue: () => void;
}) {
  if (!isCurrentRequest(requestOwner)) {
    return;
  }
  const current = optimisticActions.current[key];
  const transition = beginOptimisticAction(
    isOptimisticActionOwner(current, ownerKey) ? current : undefined,
    currentActive
  );
  setOptimisticActionState(key, optimisticActionStateForOwner(transition.state, ownerKey));
  if (!isCurrentRequest(requestOwner)) {
    if (isOptimisticActionOwner(optimisticActions.current[key], ownerKey)) {
      setOptimisticActionState(key);
    }
    return;
  }
  applyDisplayed(transition.state.displayed);
  if (transition.request) {
    startQueue();
  }
}
