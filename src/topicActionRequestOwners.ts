import {
  createRequestOwner,
  isOwnedRequest,
  supersedeRequest,
  type RequestOwner
} from './requestOwnership';

type Ref<T> = { current: T };

export type TopicActionOwnerMap = Record<string, RequestOwner>;

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
