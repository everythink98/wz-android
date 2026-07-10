import { isCurrentOwnedRequest, type RequestOwner } from './requestOwnership';

type Ref<T> = { current: T };

export function isCurrentTopicLoadRequest({
  getCurrentTopicKey,
  ownerRef,
  requestId,
  requestIdRef,
  requestOwner,
  requestTopicKey
}: {
  getCurrentTopicKey: () => string | null;
  ownerRef: Ref<RequestOwner>;
  requestId: number;
  requestIdRef: Ref<number>;
  requestOwner: RequestOwner;
  requestTopicKey: string;
}) {
  return isCurrentOwnedRequest(requestOwner, ownerRef)
    && requestId === requestIdRef.current
    && getCurrentTopicKey() === requestTopicKey;
}

export const isCurrentTopicRepliesRequest = isCurrentTopicLoadRequest;
