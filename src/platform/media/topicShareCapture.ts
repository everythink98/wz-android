import { requireOptionalNativeModule } from 'expo';
import { findNodeHandle, type ScrollView } from 'react-native';

interface NativeTopicShareCapture {
  createCapture(): string;
  capture(id: string, tag: number): Promise<{ uri: string; width: number; height: number }>;
  cancelCapture(id: string): void;
  releaseCapture(id: string): void;
}

export async function captureLongTopicImage(view: ScrollView | null, signal: AbortSignal) {
  if (signal.aborted) throw new Error('图片生成已取消');
  const native = requireOptionalNativeModule<NativeTopicShareCapture>('TopicShareCapture');
  if (!native) throw new Error('当前安装包不支持生成超长图片，请更新后重试。');
  const tag = findNodeHandle(view);
  if (!tag || tag <= 0) throw new Error('正文尚未完成排版，请重试。');
  const id = native.createCapture();
  const cancel = () => native.cancelCapture(id);
  signal.addEventListener('abort', cancel);
  try {
    const { uri } = await native.capture(id, tag);
    if (signal.aborted) throw new Error('图片生成已取消');
    return { uri, release: () => native.releaseCapture(id) };
  } catch (error) {
    native.releaseCapture(id);
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
