import { registerRootComponent } from 'expo';
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useRef, useState } from 'react';
import { Button, PixelRatio, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { TopicShareSheet } from '@/features/topic/components/TopicShareSheet';
import { captureLongTopicImage } from '@/platform/media/topicShareCapture';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { createTheme } from '@/ui/theme/tokens';

const bluePng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWNgYPj/HwADAgH/FAeIXAAAAABJRU5ErkJggg==';
const receiptUri = FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}topic-share-capture-proof.json` : null;
const body = '完整正文\n'.repeat(400);
const detailPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABaAAAACgCAIAAAB1+lw4AAAJqUlEQVR4nO3PsQkAMQADsey/dH6BXP8GgatDjc8957nIl+d5nud5nud5nud5/m++8swBnud5nud5nud5nuf5yjMHeJ7neZ7neZ7neZ7nK88c4Hme53me53me53merzxzgOd5nud5nud5nud5vvLMAZ7neZ7neZ7neZ7n+cozB3ie53me53me53me5yvPHOB5nud5nud5nud5nq88c4DneZ7neZ7neZ7neb7yzAGe53me53me53me5/nKMwd4nud5nud5nud5nucrzxzgeZ7neZ7neZ7neZ6vPHOA53me53me53me53m+8swBnud5nud5nud5nuf5yjMHeJ7neZ7neZ7neZ7nK88c4Hme53me53me53merzxzgOd5nud5nud5nud5vvLMAZ7neZ7neZ7neZ7n+cozB3ie53me53me53me5yvPHOB5nud5nud5nud5nq88c4DneZ7neZ7neZ7neb7yzAGe53me53me53me5/nKMwd4nud5nud5nud5nucrzxzgeZ7neZ7neZ7neZ6vPHOA53me53me53me53m+8swBnud5nud5nud5nuf5yjMHeJ7neZ7neZ7neZ7nK88c4Hme53me53me53merzxzgOd5nud5nud5nud5vvLMAZ7neZ7neZ7neZ7n+cozB3ie53me53me53me5yvPHOB5nud5nud5nud5nq88c4DneZ7neZ7neZ7neb7yzAGe53me53me53me5/nKMwd4nud5nud5nud5nucrzxzgeZ7neZ7neZ7neZ6vPHOA53me53me53me53m+8swBnud5nud5nud5nuf5yjMHeJ7neZ7neZ7neZ7nK88c4Hme53me53me53merzxzgOd5nud5nud5nud5vvLMAZ7neZ7neZ7neZ7n+cozB3ie53me53me53me5yvPHOB5nud5nud5nud5nq88c4DneZ7neZ7neZ7neb7yzAGe53me53me53me5/nKMwd4nud5nud5nud5nucrzxzgeZ7neZ7neZ7neZ6vPHOA53me53me53me53m+8swBnud5nud5nud5nuf5yjMHeJ7neZ7neZ7neZ7nK88c4Hme53me53me53merzxzgOd5nud5nud5nud5vvLMAZ7neZ7neZ7neZ7n+cozB3ie53me53me53me5yvPHOB5nud5nud5nud5nq88c4DneZ7neZ7neZ7neb7yzAGe53me53me53me5/nKMwd4nud5nud5nud5nucrzxzgeZ7neZ7neZ7neZ6vPHOA53me53me53me53m+8swBnud5nud5nud5nuf5yjMHeJ7neZ7neZ7neZ7nK88c4Hme53me53me53merzxzgOd5nud5nud5nud5vvLMAZ7neZ7neZ7neZ7n+cozB3ie53me53me53me5yvPHOB5nud5nud5nud5nq88c4DneZ7neZ7neZ7neb7yzAGe53me53me53me5/nKMwd4nud5nud5nud5nucrzxzgeZ7neZ7neZ7neZ6vPHOA53me53me53me53m+8swBnud5nud5nud5nuf5yjMHeJ7neZ7neZ7neZ7nK88c4Hme53me53me53merzxzgOd5nud5nud5nud5vvLMAZ7neZ7neZ7neZ7n+cozB3ie53me53me53me5yvPHOB5nud5nud5nud5nq88c4DneZ7neZ7neZ7neb7yzAGe53me53me53me5/nKMwd4nud5nud5nud5nucrzxzgeZ7neZ7neZ7neZ6vPHOA53me53me53me53m+8swBnud5nud5nud5nuf5yjMHeJ7neZ7neZ7neZ7nK88c4Hme53me53me53merzxzgOd5nud5nud5nud5vvLMAZ7neZ7neZ7neZ7n+cozB3ie53me53me53me5yvPHOB5nud5nud5nud5nq88c4DneZ7neZ7neZ7neb7yzAGe53me53me53me5/nKMwd4nud5nud5nud5nucrzxzgeZ7neZ7neZ7neZ6vPHOA53me53me53me53m+8swBnud5nud5nud5nuf5yjMHeJ7neZ7neZ7neZ7nK88c4Hme53me53me53merzxzgOd5nud5nud5nud5vvLMAZ7neZ7neZ7neZ7n+cozB3ie53me53me53me5yvPHOB5nud5nud5nud5nq88c4DneZ7neZ7neZ7neb7yzAGe53me53me53me5/nKMwd4nud5nud5nud5nucrzxzgeZ7neZ7neZ7neZ6vPHOA53me53me53me53m+8swBnud5nud5nud5nuf5yjMHeJ7neZ7neZ7neZ7nK88c4Hme53me53me53merzxzgOd5nud5nud5nud5vvLMAZ7neZ7neZ7neZ7n+cozB3ie53me53me53me5yvPHOB5nud5nud5nud5nq88c4DneZ7neZ7neZ7neb7yzAGe53me53me53me5/nKMwd4nud5nud5nud5nucrzxzgeZ7neZ7neZ7neZ6vPHOA53me53me53me53m+8swBnud5nud5nud5nuf5yjMHeJ7neZ7neZ7neZ7nK88c4Hme53me53me53merzxzgOd5nud5nud5nud5vvLMAZ7neZ7neZ7neZ7n+cozB3ie53me53me53me5yvPHOB5nud5nud5nud5nq88c4DneZ7neZ7neZ7neb7yzAGe53me53me53me5/nKMwd4nud5nud5nud5nucrzxzgeZ7neZ7neZ7neZ6vPHOA53me53me53me53m+8swBnud5nud5nud5nuf5yjMHeJ7neZ7neZ7neZ7nK88c4Hme53me53me53merzxzgOd5nud5nud5nud5vvLMAZ7neZ7neZ7neZ7n+cozB3ie53me53me53me5yvPHOB5nud5nud5nud5nq88c4DneZ7neZ7neZ7neb7yzAGe53me53me53me5/nKMwd4nud5nud5nud5nucrzxzgeZ7neZ7neZ7neZ6vPHOA53me53me53me53m+8swBnud5nud5nud5nuf5yjMHeJ7neZ7neZ7neZ7nK88c4Hme53me53me53merzxzgOd5nud5nud5nud5vvLMAZ7neZ7neZ7neZ7n+cozB3ie53me53me53me5yvPHOB5nud5nud5nud5nq88c4DneZ7neZ7neZ7neb7yzAGe53me53me53me5/nKMwd4nud5nud5nud5nucrzxzgeZ7neZ7neZ7neZ6vPHOA53me53me53me53m+8swBnud5nud5nud5nuf5yjMHeJ7neZ7neZ7neZ7nK88c4Hme53me53me53me/wBFFbCBAETWaAAAAABJRU5ErkJggg==';
const settings = createEmptyReaderData().settings;
const styleContext = { settings, theme: createTheme(settings) };

// This isolated entry captures through the production Fabric/Expo bridge and keeps its PNG for the native oracle.
function TopicShareCaptureProof() {
  const scrollRef = useRef<ScrollView>(null);
  const mounted = useRef(true);
  const operation = useRef<AbortController | null>(null);
  const result = useRef<Awaited<ReturnType<typeof captureLongTopicImage>> | null>(null);
  const [phase, setPhase] = useState('long-capture-loading');
  const [imageReady, setImageReady] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [showSheet, setShowSheet] = useState(false);
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
      <Button title="Open share sheet" onPress={() => setShowSheet(true)} />
      {showSheet ? (
        <TopicShareSheet
          topic={{
            source: 'v2ex',
            id: 'share-detail-proof',
            title: '分享清晰度验证',
            author: '阅坛',
            createdAt: '2026-10-16T00:00:00Z',
            url: 'https://www.v2ex.com/t/share-detail-proof',
            contentHtml: `<h2>正文标题</h2><p style="text-align:right;color:#bb2222"><span class="bbcode-s">右对齐删除线</span></p><img src="${bluePng}" data-original="${detailPng}" alt="高清条纹"><p>正文结尾</p>`,
            replies: []
          }}
          mediaContext={{ contentSource: 'v2ex', sessionIdentity: 'public:share-proof' }}
          onClose={() => setShowSheet(false)}
        />
      ) : null}
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

function ShareProofRoot() {
  return (
    <SafeAreaProvider>
      <ReaderStyleProvider value={styleContext}>
        <TopicShareCaptureProof />
      </ReaderStyleProvider>
    </SafeAreaProvider>
  );
}

registerRootComponent(ShareProofRoot);
