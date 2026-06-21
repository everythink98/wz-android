import { isCurrentOwnedRequest, type RequestOwner } from './requestOwnership';

type Ref<T> = { current: T };

export function isCurrentTopicLoadRequest({
  currentTopicKeyRef,
  ownerRef,
  requestId,
  requestIdRef,
  requestOwner,
  requestTopicKey
}: {
  currentTopicKeyRef: Ref<string | null>;
  ownerRef: Ref<RequestOwner>;
  requestId: number;
  requestIdRef: Ref<number>;
  requestOwner: RequestOwner;
  requestTopicKey: string;
}) {
  return isCurrentOwnedRequest(requestOwner, ownerRef)
    && requestId === requestIdRef.current
    && currentTopicKeyRef.current === requestTopicKey;
}
