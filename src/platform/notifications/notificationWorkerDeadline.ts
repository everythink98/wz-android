export function createNotificationWorkerDeadline(durationMs = 50_000) {
  const controller = new AbortController();
  const error = new Error('后台消息检查已超时');
  const reached = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(error), { once: true });
  });
  const timer = setTimeout(() => controller.abort(), durationMs);
  return {
    signal: controller.signal,
    error,
    before<T>(operation: Promise<T>) {
      return Promise.race([operation, reached]);
    },
    // Releasing the caller's timer neither cancels I/O nor releases a delivery lane.
    release() {
      clearTimeout(timer);
    }
  };
}
