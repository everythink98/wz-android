export function createNodeImageAuthRequestGate() {
  let pendingPromise: Promise<string | null> | null = null;
  let pendingResolver: ((apiKey: string | null) => void) | null = null;
  let pendingOwner: symbol | null = null;

  return {
    begin() {
      if (pendingPromise) {
        return { created: false, owner: pendingOwner as symbol, promise: pendingPromise };
      }
      pendingOwner = Symbol('nodeimage-auth-request');
      pendingPromise = new Promise<string | null>((resolve) => {
        pendingResolver = resolve;
      });
      return { created: true, owner: pendingOwner, promise: pendingPromise };
    },
    finish(owner: symbol, apiKey: string | null) {
      if (owner !== pendingOwner) {
        return false;
      }
      const resolve = pendingResolver;
      pendingResolver = null;
      pendingPromise = null;
      pendingOwner = null;
      resolve?.(apiKey);
      return true;
    }
  };
}
