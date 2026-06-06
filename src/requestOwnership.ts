export type RequestOwner = {
  key: string;
  token: number;
};

export function createRequestOwner(key = ''): RequestOwner {
  return { key, token: 0 };
}

export function supersedeRequest(owner: RequestOwner, key = owner.key): RequestOwner {
  return {
    key,
    token: owner.token + 1
  };
}

export function isOwnedRequest(requestOwner: RequestOwner, currentOwner: RequestOwner) {
  return requestOwner.key === currentOwner.key && requestOwner.token === currentOwner.token;
}

export function startOwnedRequest(ownerRef: { current: RequestOwner }, key = ownerRef.current.key): RequestOwner {
  ownerRef.current = supersedeRequest(ownerRef.current, key);
  return ownerRef.current;
}

export function isCurrentOwnedRequest(requestOwner: RequestOwner, ownerRef: { current: RequestOwner }) {
  return isOwnedRequest(requestOwner, ownerRef.current);
}
