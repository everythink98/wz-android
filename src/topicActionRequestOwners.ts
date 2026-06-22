import {
  createRequestOwner,
  isOwnedRequest,
  supersedeRequest,
  type RequestOwner
} from './requestOwnership';

type Ref<T> = { current: T };

export type TopicActionOwnerMap = Record<string, RequestOwner>;
export type TopicActionRun = {
  controller: AbortController;
  id: number;
  key: string;
};
export type TopicActionRunMap = Record<string, TopicActionRun>;
export type TopicActionBusyRunSet = Set<AbortController>;

export type TopicActionRequestOwner = {
  context: RequestOwner;
  action: RequestOwner;
};

function actionOwnerKey(key: string) {
  return `topic-action:${key}`;
}

export function startTopicActionRequestOwner(
  contextOwnerRef: Ref<RequestOwner>,
  actionOwnersRef: Ref<TopicActionOwnerMap>,
  key: string
): TopicActionRequestOwner {
  const ownerKey = actionOwnerKey(key);
  const currentOwner = actionOwnersRef.current[ownerKey] || createRequestOwner(ownerKey);
  const action = supersedeRequest(currentOwner, ownerKey);
  actionOwnersRef.current = {
    ...actionOwnersRef.current,
    [ownerKey]: action
  };
  return {
    context: contextOwnerRef.current,
    action
  };
}

export function currentTopicActionRequestOwner(
  contextOwnerRef: Ref<RequestOwner>,
  actionOwnersRef: Ref<TopicActionOwnerMap>,
  key: string
): TopicActionRequestOwner {
  const ownerKey = actionOwnerKey(key);
  const action = actionOwnersRef.current[ownerKey] || createRequestOwner(ownerKey);
  if (!actionOwnersRef.current[ownerKey]) {
    actionOwnersRef.current = {
      ...actionOwnersRef.current,
      [ownerKey]: action
    };
  }
  return {
    context: contextOwnerRef.current,
    action
  };
}

export function isCurrentTopicActionRequestOwner(
  requestOwner: TopicActionRequestOwner,
  contextOwnerRef: Ref<RequestOwner>,
  actionOwnersRef: Ref<TopicActionOwnerMap>
) {
  const currentActionOwner = actionOwnersRef.current[requestOwner.action.key];
  return Boolean(
    currentActionOwner
    && isOwnedRequest(requestOwner.context, contextOwnerRef.current)
    && isOwnedRequest(requestOwner.action, currentActionOwner)
  );
}

export function startTopicActionRun(actionRunsRef: Ref<TopicActionRunMap>, key: string): TopicActionRun {
  const previous = actionRunsRef.current[key];
  previous?.controller.abort();
  const run = {
    controller: new AbortController(),
    id: (previous?.id || 0) + 1,
    key
  };
  actionRunsRef.current = {
    ...actionRunsRef.current,
    [key]: run
  };
  return run;
}

export function isCurrentTopicActionRun(run: TopicActionRun, actionRunsRef: Ref<TopicActionRunMap>) {
  const current = actionRunsRef.current[run.key];
  return Boolean(current && current.id === run.id && current.controller === run.controller && !current.controller.signal.aborted);
}

export function finishTopicActionRun(run: TopicActionRun, actionRunsRef: Ref<TopicActionRunMap>) {
  if (actionRunsRef.current[run.key]?.controller !== run.controller) {
    return Object.keys(actionRunsRef.current).length === 0;
  }
  const next = { ...actionRunsRef.current };
  delete next[run.key];
  actionRunsRef.current = next;
  return Object.keys(next).length === 0;
}

export function abortTopicActionRuns(actionRunsRef: Ref<TopicActionRunMap>) {
  const abortedControllers = Object.values(actionRunsRef.current).map((run) => run.controller);
  for (const run of Object.values(actionRunsRef.current)) {
    run.controller.abort();
  }
  actionRunsRef.current = {};
  return abortedControllers;
}

export function trackBusyTopicActionRun(busyRunsRef: Ref<TopicActionBusyRunSet>, run: TopicActionRun) {
  busyRunsRef.current.add(run.controller);
}

export function finishBusyTopicActionRun(busyRunsRef: Ref<TopicActionBusyRunSet>, run: TopicActionRun) {
  busyRunsRef.current.delete(run.controller);
  return busyRunsRef.current.size > 0;
}

export function clearBusyTopicActionRuns(busyRunsRef: Ref<TopicActionBusyRunSet>) {
  busyRunsRef.current.clear();
}
