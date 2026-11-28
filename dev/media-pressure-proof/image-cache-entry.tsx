import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { Linking, PixelRatio, StatusBar, Text, useWindowDimensions, View } from 'react-native';
import RenderHTML from 'react-native-render-html';
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { registerRootComponent } from 'expo';
import { nativeBuildVersion } from 'expo-application';
import { File, Paths } from 'expo-file-system';
import { useKeepAwake } from 'expo-keep-awake';
import { hideAsync } from 'expo-splash-screen';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import type { PreparedTopicDetail } from '@/domain/forum/topicContentSplit';
import {
  TopicBodyMediaCoordinatorProvider,
  TopicBodyMediaRowBoundary
} from '@/features/topic/media/TopicBodyMediaCoordinator';
import { useImagePreviewController } from '@/features/topic/media/useImagePreviewController';
import { useHtmlRenderingController } from '@/features/topic/rendering/useHtmlRenderingController';
import { diagnosticBuildContext } from '@/platform/diagnostics/nativeDiagnosticJournal';
import { useForumMediaRequestContext } from '@/platform/media/mediaSessionEpoch';
import { createAppQueryClient } from '@/platform/query/serverState';
import { createTheme } from '@/ui/theme/tokens';
import { check } from '../proofCheck';
import {
  catalogSize,
  imageTopicKey,
  pagesPerTopic,
  prepareImageTopic,
  topicCount,
  type TopicImageSamples
} from './image-cache-workload';

const samples: TopicImageSamples[] = require('../../.codex-tmp/media-pressure-assets/topic-image-samples.json');
check(samples.length === topicCount, 'Generate all fifteen local image sets before building');
const settings = createEmptyReaderData().settings;
const theme = createTheme(settings);
const noop = () => {};
type Command = { token: string; step: number; topic: number; page: number };
type Box = { x: number; y: number; width: number; height: number };
type Media = 'upper' | 'lower';
const media: readonly Media[] = ['upper', 'lower'];
type Boxes = Record<Media, Box>;
type Geometry = { idle: Boxes; displayed: Boxes };

function commandFor(url: string | null): Command | null {
  if (!url?.startsWith('wztopicimagecache://run?')) return null;
  const params = new URL(url).searchParams;
  const token = params.get('token') || '';
  const step = Number(params.get('step'));
  const topic = Number(params.get('topic'));
  const page = Number(params.get('page'));
  return /^[a-zA-Z0-9_-]{8,80}$/.test(token) &&
    Number.isSafeInteger(step) &&
    step > 0 &&
    Number.isInteger(topic) &&
    topic >= 0 &&
    topic <= topicCount &&
    Number.isInteger(page) &&
    page >= 0 &&
    page < pagesPerTopic &&
    (topic > 0 || page === 0)
    ? { token, step, topic, page }
    : null;
}

const DisplayedRows = memo(function DisplayedRows({
  topic,
  page,
  width,
  onReady
}: {
  topic: PreparedTopicDetail;
  page: number;
  width: number;
  onReady: (geometry: Geometry) => void;
}) {
  const refs = useRef<Partial<Record<Media, View | null>>>({});
  const [layoutRevision, layoutChanged] = useReducer((previous: number) => previous + 1, 0);
  const [idle, setIdle] = useState<Boxes | null>(null);
  const [displayed, setDisplayed] = useState(false);
  const onDisplay = useCallback((rows: ReadonlySet<string>) => setDisplayed(media.every((key) => rows.has(key))), []);
  const mediaContext = useForumMediaRequestContext('nodeseek');
  const controller = useHtmlRenderingController({
    mediaSessionIdentity: mediaContext.sessionIdentity,
    settings,
    theme,
    selectedTopic: topic,
    topicDetail: topic,
    onOpenExternalUrl: noop,
    onOpenImagePreview: noop,
    onOpenTopic: noop,
    onOpenUser: noop,
    webViewBlockMessage: ''
  });
  const previews = topic.preparedContent.contentPlan.previewImages;
  const sources = useMemo(
    () => ({
      upper: {
        html: `<img src="${previews[page ? page * 2 - 1 : 0].source}" width="384" height="216" style="max-width:180px">`
      },
      lower: { html: `<img src="${previews[page ? page * 2 : previews.length - 1].source}" width="384" height="216">` }
    }),
    [page, previews]
  );
  useEffect(() => {
    if (!layoutRevision || (idle && !displayed)) return;
    let current = true;
    const frame = requestAnimationFrame(() => {
      const measured: Partial<Boxes> = {};
      for (const kind of media) {
        refs.current[kind]?.measureInWindow((x, y, w, h) => {
          if (!current || !(w > 0 && h > 0)) return;
          const pixels = PixelRatio.getPixelSizeForLayoutSize;
          measured[kind] = { x: pixels(x), y: pixels(y), width: pixels(w), height: pixels(h) };
          if (!measured.upper || !measured.lower) return;
          const boxes = { upper: measured.upper, lower: measured.lower };
          if (idle) onReady({ idle, displayed: boxes });
          else setIdle(boxes);
        });
      }
    });
    return () => {
      current = false;
      cancelAnimationFrame(frame);
    };
  }, [displayed, idle, layoutRevision, onReady]);
  return (
    <TopicBodyMediaCoordinatorProvider active paused={!idle} viewportRowKeys={media} onDisplayedRowsChange={onDisplay}>
      {media.map((kind) => (
        <View
          key={kind}
          collapsable={false}
          style={{ width }}
          ref={(view) => {
            refs.current[kind] = view;
          }}
          onLayout={layoutChanged}
        >
          <TopicBodyMediaRowBoundary rowKey={kind}>
            <RenderHTML
              contentWidth={width}
              renderers={controller.htmlRenderers}
              renderersProps={controller.htmlRenderersProps}
              source={sources[kind]}
            />
          </TopicBodyMediaRowBoundary>
        </View>
      ))}
    </TopicBodyMediaCoordinatorProvider>
  );
});

function Step({ command, loadsRef }: { command: Command; loadsRef: { current: number } }) {
  const client = useQueryClient();
  const cache = client.getQueryCache();
  const cached = useSyncExternalStore(
    cache.subscribe,
    () => cache.getAll().filter((q) => q.queryKey[0] === 'forum').length
  );
  const width = Math.min(384, Math.floor(useWindowDimensions().width) - 24);
  const [measurement, setMeasurement] = useState<{ step: number; geometry: Geometry } | null>(null);
  const geometry = measurement?.step === command.step ? measurement.geometry : null;
  const onReady = useCallback(
    (next: Geometry) => setMeasurement({ step: command.step, geometry: next }),
    [command.step]
  );
  const { topic } = command;
  const { registerImagePreviewDescriptors, openImagePreview, closeImagePreview, imagePreview } =
    useImagePreviewController({
      contentSource: topic ? 'nodeseek' : null,
      contentWidth: width,
      notify: noop,
      scope: topic ? `nodeseek:${topic}` : null
    });
  const [catalog, setCatalog] = useState<{ count: number; lastIndex: number } | null>(null);
  const key = useMemo(() => (topic ? imageTopicKey(topic) : ['image-proof-idle']), [topic]);
  const query = useQuery({
    queryKey: key,
    enabled: topic > 0,
    queryFn: () => {
      const pair = samples[topic - 1];
      const data = prepareImageTopic(topic, pair);
      const previews = data.preparedContent.contentPlan.previewImages;
      check(
        previews.length === catalogSize &&
          previews[0].source === pair.animation &&
          previews.at(-1)?.source === pair.photos[0] &&
          pair.photos.slice(1).every((photo, index) => previews[index + 1].source === photo),
        'Compiled data must contain all eight local images in their expected slots'
      );
      loadsRef.current++;
      return data;
    }
  });
  useEffect(() => {
    if (!query.data) return;
    const descriptors = query.data.preparedContent.contentPlan.previewImages;
    registerImagePreviewDescriptors(descriptors);
    openImagePreview(descriptors[descriptors.length - 1].source);
  }, [query.data, registerImagePreviewDescriptors, openImagePreview]);
  useEffect(() => {
    if (!imagePreview) return;
    setCatalog({ count: imagePreview.items.length, lastIndex: imagePreview.index });
    closeImagePreview();
  }, [imagePreview, closeImagePreview]);
  const phase =
    topic === 0 ? 'idle' : !query.data ? 'compile' : !catalog ? 'catalog' : !geometry ? 'images' : 'displayed';
  useEffect(() => {
    new File(Paths.cache, 'topic-image-pressure.json').write(
      JSON.stringify({
        ...diagnosticBuildContext(),
        installedVersionCode: Number(nativeBuildVersion),
        ...command,
        phase,
        isHermes: 'HermesInternal' in globalThis,
        isDev: __DEV__,
        cached,
        loads: loadsRef.current,
        geometry,
        catalog,
        catalogSize,
        pagesPerTopic,
        error: query.error?.message || null
      })
    );
  }, [phase, query.error, command, cached, loadsRef, geometry, catalog]);
  return (
    <View style={{ flex: 1, backgroundColor: '#ffffff', padding: 12 }}>
      <StatusBar hidden />
      <Text style={{ color: '#000000' }}>
        Topic {topic} / {topicCount}
      </Text>
      {topic > 0 && query.data ? (
        <DisplayedRows key={command.step} topic={query.data} page={command.page} width={width} onReady={onReady} />
      ) : null}
    </View>
  );
}

function Run({ command }: { command: Command }) {
  useKeepAwake('topic-image-pressure');
  const [client] = useState(createAppQueryClient);
  const loadsRef = useRef(0);
  useEffect(() => () => client.clear(), [client]);
  return (
    <QueryClientProvider client={client}>
      <Step key={command.topic} command={command} loadsRef={loadsRef} />
    </QueryClientProvider>
  );
}

function App() {
  const [command, setCommand] = useState<Command | null>(null);
  useEffect(() => {
    const accept = (url: string | null) => {
      const next = commandFor(url);
      if (next)
        setCommand((previous) => (previous?.token === next.token && previous.step >= next.step ? previous : next));
    };
    const subscription = Linking.addEventListener('url', ({ url }) => accept(url));
    void Linking.getInitialURL().then(accept);
    void hideAsync().catch(noop);
    return () => subscription.remove();
  }, []);
  return command ? <Run key={command.token} command={command} /> : <Text>Waiting for an image pressure run</Text>;
}

registerRootComponent(App);
