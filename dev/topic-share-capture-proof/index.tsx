import { registerRootComponent } from 'expo';
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useRef, useState } from 'react';
import { Button, PixelRatio, ScrollView, Text, View } from 'react-native';
import { captureLongTopicImage } from '@/platform/media/topicShareCapture';

const bluePng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWNgYPj/HwADAgH/FAeIXAAAAABJRU5ErkJggg==';
const receiptUri = FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}topic-share-capture-proof.json` : null;
const body = '完整正文\n'.repeat(400);

// This isolated entry captures through the production Fabric/Expo bridge and keeps its PNG for the native oracle.
function TopicShareCaptureProof() {
  const scrollRef = useRef<ScrollView>(null);
  const mounted = useRef(true);
  const operation = useRef<AbortController | null>(null);
  const result = useRef<Awaited<ReturnType<typeof captureLongTopicImage>> | null>(null);
  const [phase, setPhase] = useState('long-capture-loading');
  const [imageReady, setImageReady] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const ready = imageReady && size.width > 0 && size.height * PixelRatio.get() > 32_000;
  const status = phase === 'long-capture-loading' && ready ? 'long-capture-ready' : phase;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      result.current?.release();
      result.current = null;
      if (receiptUri) void FileSystem.deleteAsync(receiptUri, { idempotent: true }).catch(() => undefined);
    };
  }, []);

  const capture = async () => {
    if (!ready || !mounted.current || operation.current || result.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setPhase('long-capture-pending');
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      result.current = await captureLongTopicImage(scrollRef.current, controller.signal);
      if (!mounted.current || controller.signal.aborted) throw new Error('图片生成已取消');
      if (!receiptUri) throw new Error('测试缓存目录不可用');
      await FileSystem.writeAsStringAsync(
        receiptUri,
        JSON.stringify({
          uri: result.current.uri,
          sourceWidth: size.width,
          sourceHeight: size.height,
          density: PixelRatio.get()
        })
      );
      if (!mounted.current || controller.signal.aborted) throw new Error('图片生成已取消');
      setPhase('long-capture-complete');
    } catch (error) {
      result.current?.release();
      result.current = null;
      if (receiptUri) await FileSystem.deleteAsync(receiptUri, { idempotent: true }).catch(() => undefined);
      if (mounted.current) setPhase(`long-capture-error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      operation.current = null;
    }
  };

  const release = () => {
    result.current?.release();
    result.current = null;
    setPhase('long-capture-released');
  };

  return (
    <View
      testID="long-capture-proof"
      collapsable={false}
      style={{ flex: 1, paddingTop: 48, backgroundColor: '#ffffff' }}
    >
      <Text testID={status}>{status}</Text>
      <Button title="Capture" disabled={status !== 'long-capture-ready'} onPress={() => void capture()} />
      <Button title="Release" disabled={status !== 'long-capture-complete'} onPress={release} />
      <ScrollView
        ref={scrollRef}
        testID="long-capture-content"
        removeClippedSubviews={false}
        style={{ width: 360, flex: 1 }}
        onContentSizeChange={(width, height) => setSize({ width, height })}
      >
        <View collapsable={false} style={{ width: 360, height: 20_000, backgroundColor: '#ffffff' }}>
          <View testID="long-capture-head" collapsable={false} style={{ height: 64, backgroundColor: '#ff0000' }} />
          <Image
            testID="long-capture-image"
            source={{ uri: bluePng }}
            style={{ width: 360, height: 64 }}
            contentFit="fill"
            transition={0}
            autoplay={false}
            onDisplay={() => setImageReady(true)}
            onError={({ error }) => setPhase(`long-capture-error: ${error}`)}
          />
          <View style={{ flex: 1, padding: 16 }}>
            <Text style={{ fontSize: 16, lineHeight: 28, color: '#111111' }}>{body}</Text>
          </View>
          <View testID="long-capture-tail" collapsable={false} style={{ height: 64, backgroundColor: '#00ff00' }} />
        </View>
      </ScrollView>
    </View>
  );
}

registerRootComponent(TopicShareCaptureProof);
