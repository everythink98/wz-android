import '@/platform/diagnostics/diagnosticBootstrap';
import { registerRootComponent } from 'expo';
import { hideAsync } from 'expo-splash-screen';
import { File, Paths } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { AppState, Button, Keyboard, Linking, Text, View } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AppFrame } from '@/app/AppComposition';
import { appQueryClient } from '@/platform/query/serverState';
import { diagnosticBuildContext } from '@/platform/diagnostics/nativeDiagnosticJournal';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { createTheme } from '@/ui/theme/tokens';
import { createAppStyles } from '@/app/styles';
import {
  createComposerTransport,
  TopicSubmissionFixture,
  type ComposerObservation,
  type ComposerOutcome,
  type ComposerEntry
} from '../../tests/ui/composerSubmissionFixture';
import type { SessionSite } from '@/domain/session/siteSessionState';
import { MessageSubmissionFixture } from '../../tests/ui/composerMessageFixture';
import { TopicCreationFixture, type TopicProofObservation } from '../../tests/ui/topicCreationFixture';
import { createTopicProofTransport, type TopicProofOutcome } from '../../tests/helpers/topicCreationTransport';
import { createTopicEditTransport } from '../../tests/helpers/topicEditingTransport';

// Materialize React Native's lazy Fetch polyfill before replacing its network entry.
void globalThis.Response;
globalThis.fetch = async () => {
  throw new Error('Uncontrolled network blocked by composer proof');
};
const Stack = createNativeStackNavigator();
type Scenario = {
  token: string;
  source: SessionSite;
  entry: ComposerEntry | 'topic' | 'topic-edit';
  outcome: ComposerOutcome | 'enqueued';
  dark: boolean;
  stress: string;
};
function Proof({ scenario }: { scenario: Scenario }) {
  const [transport] = useState(() =>
    createComposerTransport(
      scenario.outcome === 'enqueued' ? 'success' : scenario.outcome,
      false,
      scenario.stress === 'delay' || scenario.stress === 'image-upload' ? 2000 : 0,
      scenario.stress === 'image-upload'
    )
  );
  const [topicTransport] = useState(() =>
    createTopicProofTransport(scenario.outcome as TopicProofOutcome, scenario.stress === 'upload-ack')
  );
  const [topicObservation, observeTopic] = useState<TopicProofObservation>();
  const [editTransport] = useState(() => {
    const value = createTopicEditTransport(scenario.source, String(parseInt(scenario.token.slice(0, 8), 16) + 1000));
    value.state.title = `Local ${scenario.source} topic proof`;
    value.respond((path) => {
      if (scenario.outcome === 'network-error') throw new Error('isolated connection lost');
      if (scenario.outcome === 'unconfirmed') return new Response('{}');
      if (scenario.outcome === 'rejected' || (scenario.stress === 'partial' && path === '/posts/789.json'))
        return scenario.source === 'yaohuo'
          ? new Response('<div class="tip">修改失败</div>')
          : new Response(JSON.stringify({ success: false, errors: ['修改被拒绝'] }), { status: 422 });
      return undefined;
    });
    return value;
  });
  const [observation, observe] = useState<ComposerObservation>();
  const [notice, setNotice] = useState('');
  const [keyboardShown, setKeyboardShown] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [, refresh] = useState(0);
  const settings = {
    ...createEmptyReaderData().settings,
    theme: scenario.dark ? ('dark' as const) : ('light' as const)
  };
  const theme = createTheme(settings);
  const styles = createAppStyles(theme);
  useEffect(() => {
    void hideAsync();
    transport.setObserver(() => refresh((value) => value + 1));
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardShown(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardShown(false));
    const lifecycle = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => {
      show.remove();
      hide.remove();
      lifecycle.remove();
      transport.dispose();
    };
  }, [transport]);
  useEffect(() => {
    new File(Paths.cache, 'composer-proof.json').write(
      JSON.stringify({
        ...scenario,
        notice,
        ...observation,
        keyboardShown,
        appActive,
        uploads: transport.uploads,
        requests: transport.requests.length,
        confirmations: transport.confirmations,
        ...(scenario.stress.startsWith('ime-')
          ? {
              submittedContents: transport.requests.map(({ body }) => (JSON.parse(body) as { content: string }).content)
            }
          : {}),
        ...(['topic', 'topic-edit'].includes(scenario.entry) ? { topic: topicObservation } : {}),
        isDev: __DEV__,
        isHermes: 'HermesInternal' in globalThis,
        ...diagnosticBuildContext()
      })
    );
  });
  return (
    <ReaderStyleProvider value={{ settings, theme }}>
      <AppFrame styles={styles} dark={theme.dark}>
        {scenario.entry === 'topic' || scenario.entry === 'topic-edit' ? (
          <TopicCreationFixture
            token={scenario.token}
            source={scenario.source}
            transport={topicTransport}
            observe={observeTopic}
            onNotice={setNotice}
            kind={scenario.stress}
            editTransport={scenario.entry === 'topic-edit' ? editTransport : undefined}
          />
        ) : scenario.entry === 'message' ? (
          <MessageSubmissionFixture source={scenario.source} transport={transport} onNotice={setNotice} />
        ) : (
          <NavigationContainer>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="TopicProof">
                {() => (
                  <TopicSubmissionFixture
                    active={appActive}
                    routeActive
                    source={scenario.source}
                    entry={scenario.entry as 'reply' | 'floor' | 'edit'}
                    transport={transport}
                    observe={observe}
                    reopenAfterSuccess={scenario.stress === 'reopen'}
                  />
                )}
              </Stack.Screen>
            </Stack.Navigator>
          </NavigationContainer>
        )}
        <Text accessibilityLabel="Mock 隔离环境" style={{ position: 'absolute', bottom: 30 }}>
          {scenario.token}
        </Text>
        {!['topic', 'topic-edit'].includes(scenario.entry) && (
          <View style={{ position: 'absolute', bottom: 65 }}>
            <Button
              title="下一次成功"
              onPress={() => {
                transport.setOutcome('success');
              }}
            />
          </View>
        )}
      </AppFrame>
    </ReaderStyleProvider>
  );
}
function App() {
  const [scenario, setScenario] = useState<Scenario>();
  const seen = useRef('');
  useEffect(() => {
    function accept(url: string) {
      if (seen.current === url) return;
      const parsed = new URL(url);
      if (parsed.protocol !== 'wzcomposerproof:') return;
      const token = parsed.hostname;
      const source = parsed.searchParams.get('source') || 'nodeseek';
      const entry = parsed.searchParams.get('entry') || 'reply';
      const outcome = parsed.searchParams.get('outcome') || 'success';
      if (
        !/^[a-f0-9]{32}$/.test(token) ||
        !['nodeseek', 'linuxdo', 'yaohuo'].includes(source) ||
        !['reply', 'floor', 'edit', 'message', 'topic', 'topic-edit'].includes(entry) ||
        !['success', 'network-error', 'rejected', 'unconfirmed', 'refresh-error', 'enqueued'].includes(outcome)
      )
        return;
      seen.current = url;
      appQueryClient.clear();
      setScenario({
        token,
        source: source as SessionSite,
        entry: entry as Scenario['entry'],
        outcome: outcome as Scenario['outcome'],
        dark: parsed.searchParams.get('theme') === 'dark',
        stress: parsed.searchParams.get('stress') || ''
      });
    }
    void Linking.getInitialURL().then((url) => {
      if (url) accept(url);
    });
    const subscription = Linking.addEventListener('url', ({ url }) => accept(url));
    return () => subscription.remove();
  }, []);
  return (
    <QueryClientProvider client={appQueryClient}>
      {scenario ? <Proof key={scenario.token} scenario={scenario} /> : <Text>等待 Mock 场景</Text>}
    </QueryClientProvider>
  );
}
registerRootComponent(App);
