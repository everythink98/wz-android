import { useEffect, useMemo, useState } from 'react';
import { loadLinuxDoTopicCreationContext } from '@/sources/linuxdo/topicCreation';
import { Button, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { File, Paths } from 'expo-file-system';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TopicComposerRoute } from '@/features/topic-composer/TopicComposerRoute';
import {
  TopicComposerRouteRuntimeProvider,
  type TopicComposerRouteRuntimeValue
} from '@/features/topic-composer/TopicComposerRouteRuntime';
import { emptyTopicDraft, type TopicCreationSource, type YaohuoTopicKind } from '@/domain/forum/topicComposer';
import { editableTopicFields } from '@/domain/forum/topicComposer';
import type { createTopicEditTransport } from '../helpers/topicEditingTransport';
import { loadLinuxDoTopicEditContext } from '@/sources/linuxdo/topicEditing';
import { loadNodeSeekTopicEditContext } from '@/sources/nodeseek/topicEditing';
import { loadYaohuoTopicEditContext } from '@/sources/yaohuo/topicEditing';
import { persistTopicDraftAttachment } from '@/platform/media/topicDraftAttachments';
import { createSiteSessionStates, siteSessionIdentityKey } from '@/domain/session/siteSessionState';
import {
  ensureWritableSessionTicket,
  validateWritableSessionTicket,
  type WritableSessionSnapshot
} from '@/domain/session/writableSessionGate';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { loadTopicDraft, readTopicSubmissionAttempt, saveTopicDraft } from '@/platform/persistence/topicDrafts';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { projectTestAccountSessions } from '../helpers/accountSessions';
import {
  TOPIC_PROOF_SOURCES,
  topicProofBody,
  topicProofTitle,
  type createTopicProofTransport
} from '../helpers/topicCreationTransport';

const Stack = createNativeStackNavigator<RootStackParamList>();
export type TopicProofObservation = {
  ready: boolean;
  route: string;
  drafts: Partial<Record<TopicCreationSource, { exists: boolean; retained: boolean; empty: boolean }>>;
  attempts: Partial<Record<TopicCreationSource, string>>;
  writes: number;
  uploads: number;
  blockedRequests: number;
  lastWrite?: { path: string; fields: Record<string, number> };
  error?: string;
  edit?: {
    exists: boolean;
    title?: string;
    bodyExact: boolean;
    otherDraftRetained: boolean;
    status?: string;
    writes: number;
    blockedRequests: number;
  };
};

export function TopicCreationFixture({
  token,
  source,
  transport,
  observe,
  onNotice,
  kind,
  editTransport
}: {
  token: string;
  source: TopicCreationSource;
  transport: ReturnType<typeof createTopicProofTransport>;
  observe: (value: TopicProofObservation) => void;
  onNotice: (value: string) => void;
  kind: string;
  editTransport?: ReturnType<typeof createTopicEditTransport>;
}) {
  const editOriginalBody = useMemo(() => editTransport?.state.body, [editTransport]);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState('');
  const navigation = useNavigationContainerRef<RootStackParamList>();
  const sessions = useMemo(() => {
    const states = createSiteSessionStates();
    for (const site of TOPIC_PROOF_SOURCES)
      states[site] = {
        ...states[site],
        status: 'logged-in',
        currentUser: {
          source: site,
          id: String(parseInt(token.slice(0, 8), 16) + 1000),
          username: 'local-proof',
          url: `https://proof.invalid/${site}`
        }
      };
    return projectTestAccountSessions(states);
  }, [token, editTransport]);
  const runtime = useMemo<TopicComposerRouteRuntimeValue>(() => {
    const snapshot = (site: TopicCreationSource): WritableSessionSnapshot => ({
      source: site,
      authenticated: true,
      authSurfaceOpen: false,
      identityKey: siteSessionIdentityKey(sessions[site]),
      identityTrust: sessions[site].identityTrust,
      sessionEpoch: 0,
      sourceEnabled: true
    });
    return {
      enabledSources: TOPIC_PROOF_SOURCES,
      sessions,
      sessionEpochs: initialForumSessionEpochs,
      appActive: true,
      fetcher: async (input, init) => {
        if (editTransport) return editTransport.fetcher(input, init);
        if (kind === 'inactive-receipt' && init?.method === 'POST') {
          const response = await transport.fetcher(input, init);
          // An incoming topic link retains the submitting route below a new native screen.
          await new Promise<void>((resolve) => {
            const unsubscribe = navigation.addListener('state', () => {
              if (navigation.getCurrentRoute()?.name !== 'Topic') return;
              unsubscribe();
              setTimeout(resolve, 0);
            });
            navigation.navigate('Topic', {
              topic: {
                id: '456',
                source,
                title: '另一主题',
                author: 'proof',
                url: 'https://example.invalid/456',
                createdAt: ''
              }
            });
          });
          return response;
        }
        return transport.fetcher(input, init);
      },
      ensureNetworkProxyReady: async () => {},
      ensureWritableSession: (site) =>
        ensureWritableSessionTicket(
          () => snapshot(site),
          async () => ({ status: 'same' })
        ),
      isWritableSessionTicketCurrent: (ticket) => validateWritableSessionTicket(ticket, snapshot(ticket.source)),
      ensureNodeImageApiKey: async () => null,
      getUserAgent: () => 'isolated-topic-proof',
      getTopic: async () => {
        throw new Error('No cached topic in this fixture');
      },
      getTopicEditContext: (options) => {
        if (!editTransport) throw new Error('Unexpected edit context request');
        const input = { ...options, fetcher: editTransport.fetcher };
        return options.source === 'linuxdo'
          ? loadLinuxDoTopicEditContext(input)
          : options.source === 'nodeseek'
            ? loadNodeSeekTopicEditContext(input)
            : loadYaohuoTopicEditContext(input);
      },
      getEmojiUrls: async () => ({
        smile: 'https://linux.do/images/emoji/twitter/smile.png',
        heart: 'https://linux.do/images/emoji/twitter/heart.png'
      }),
      getLinuxDoTopicCreationContext: ({ signal }) =>
        loadLinuxDoTopicCreationContext({ fetcher: transport.fetcher, userAgent: 'isolated-topic-proof', signal }),
      openAccount: () => {
        throw new Error('Original account UI is unavailable in isolated proof');
      },
      notify: onNotice
    };
  }, [kind, navigation, onNotice, sessions, source, transport, editTransport]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const seeded = new File(Paths.cache, `topic-proof-${token}.seeded`);
      if (seeded.exists) {
        if (active) setReady(true);
        return;
      }
      for (const site of TOPIC_PROOF_SOURCES) {
        const identity = siteSessionIdentityKey(sessions[site]);
        if (await loadTopicDraft(site, identity)) continue;
        // Per-run synthetic identities keep all existing local accounts/drafts untouched.
        // A completed run is never reused as a new scenario token.
        if (await readTopicSubmissionAttempt(site, identity)) continue;
        const draft = {
          ...emptyTopicDraft(site, identity),
          title: topicProofTitle(site),
          body: topicProofBody(site),
          categoryId: site === 'nodeseek' ? 'tech' : site === 'linuxdo' ? '4' : '213'
        };
        if (draft.source === 'yaohuo' && ['gift', 'poll', 'resources', 'files'].includes(kind)) {
          draft.kind = kind as YaohuoTopicKind;
          draft.gift = { total: '2000', perPerson: '200' };
          draft.poll = { options: ['选项一', '选项二', '选项三'], giftEnabled: false, total: '', perPerson: '' };
          draft.resources = [
            {
              title: '本地协议样本',
              url: 'https://example.invalid/resource',
              size: '1KB',
              extension: 'txt',
              description: 'Mock only'
            }
          ];
          if (kind === 'files') {
            const file = new File(Paths.cache, `topic-proof-${token}.txt`);
            file.write('Local file; never uploaded.');
            draft.attachments = [
              await persistTopicDraftAttachment({
                draft,
                kind: 'yaohuo-file',
                asset: {
                  name: 'topic-proof.txt',
                  uri: file.uri,
                  mimeType: 'text/plain',
                  size: file.size
                }
              })
            ];
          }
        }
        if (!(await saveTopicDraft(draft))) throw new Error('Proof draft could not be seeded');
        if (editTransport && site === source) {
          if (
            !(await saveTopicDraft({
              ...draft,
              id: `${draft.id}-other`,
              edit: { topicId: '456', original: editableTopicFields(draft) }
            }))
          )
            throw new Error('Other edit draft could not be seeded');
        }
      }
      seeded.write('seeded');
      if (active) setReady(true);
    })().catch((cause) => {
      if (active) setFailure(String(cause));
    });
    return () => {
      active = false;
    };
  }, [kind, sessions, token, source, editTransport]);
  useEffect(() => {
    let active = true;
    let pending = false;
    const sample = async () => {
      if (pending) return;
      pending = true;
      const value: TopicProofObservation = {
        ready,
        route: navigation.isReady() ? navigation.getCurrentRoute()?.name || '' : '',
        drafts: {},
        attempts: {},
        writes: transport.writes.length,
        uploads: transport.uploads,
        blockedRequests: transport.blockedRequests,
        lastWrite: transport.writes.at(-1),
        ...(failure ? { error: failure } : {})
      };
      try {
        if (ready)
          for (const site of TOPIC_PROOF_SOURCES) {
            const identity = siteSessionIdentityKey(sessions[site]);
            const draft = await loadTopicDraft(site, identity);
            const attempt = await readTopicSubmissionAttempt(site, identity);
            value.drafts[site] = {
              exists: Boolean(draft),
              retained: draft?.title === topicProofTitle(site) && draft.body === topicProofBody(site),
              empty: !draft || (!draft.title && !draft.body)
            };
            if (attempt) value.attempts[site] = attempt.status;
          }
        if (ready && editTransport) {
          const identity = siteSessionIdentityKey(sessions[source]);
          const draft = await loadTopicDraft(source, identity, 'edit:123');
          const other = await loadTopicDraft(source, identity, 'edit:456');
          const attempt = await readTopicSubmissionAttempt(source, identity, 'edit:123');
          value.edit = {
            exists: Boolean(draft),
            title: draft?.title,
            bodyExact: (!draft || draft.body === editOriginalBody) && editTransport.state.body === editOriginalBody,
            otherDraftRetained: other?.title === topicProofTitle(source) && other.body === topicProofBody(source),
            status: attempt?.status,
            writes: editTransport.writes().length,
            blockedRequests: editTransport.blockedRequests()
          };
        }
        if (active) observe(value);
      } catch (cause) {
        if (active) observe({ ...value, error: String(cause) });
      } finally {
        pending = false;
      }
    };
    void sample();
    const timer = setInterval(() => void sample(), 250);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [failure, navigation, observe, ready, sessions, transport, editTransport, editOriginalBody, source]);
  if (!ready) return <Text>{failure || '准备本机测试草稿'}</Text>;
  return (
    <TopicComposerRouteRuntimeProvider value={runtime}>
      <NavigationContainer ref={navigation}>
        <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="MainTabs">
          <Stack.Screen name="MainTabs">
            {({ navigation: nav }) => (
              <SafeAreaView edges={['top']}>
                <Text>发帖隔离回放</Text>
                <Button
                  title="打开测试发帖"
                  onPress={() => nav.navigate('TopicComposer', { kind: 'create', initialSource: source })}
                />
                {editTransport ? (
                  <Button
                    title="编辑测试主帖"
                    onPress={() => nav.navigate('TopicComposer', { kind: 'edit', source, topicId: '123' })}
                  />
                ) : null}
              </SafeAreaView>
            )}
          </Stack.Screen>
          <Stack.Screen name="TopicComposer" component={TopicComposerRoute} />
          <Stack.Screen name="Topic">
            {({ route, navigation: nav }) => (
              <SafeAreaView edges={['top']}>
                <Text accessibilityLabel="Mock 新主题详情">{route.params.topic.title}</Text>
                {kind === 'inactive-receipt' && <Button title="返回发帖" onPress={() => nav.goBack()} />}
              </SafeAreaView>
            )}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </TopicComposerRouteRuntimeProvider>
  );
}
