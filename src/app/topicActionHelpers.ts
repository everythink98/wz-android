export async function shareTopicWithClipboardFallback({
  copy,
  notify,
  share
}: {
  copy: () => Promise<void>;
  notify: (message: string) => void;
  share: () => Promise<void>;
}) {
  try {
    await share();
    return true;
  } catch {
    try {
      await copy();
      notify('链接已复制');
      return true;
    } catch {
      notify('分享失败，且无法复制链接，请重试。');
      return false;
    }
  }
}
