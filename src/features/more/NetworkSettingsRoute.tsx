import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { AppState, Pressable, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import { Check, ChevronRight, Copy, RefreshCw } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { IconButton } from '@/ui/controls/ButtonControls';
import { PillRail } from '@/ui/controls/SelectionControls';
import { readNetworkLog, type NetworkLogEntry } from '@/platform/diagnostics/networkLog';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { createUiFontSizer, readerRadii, type ReaderStyleSettings, type ReaderTheme } from '@/ui/theme/tokens';
import { errorMessage } from '@/platform/network/errors';
import { sourceCatalog, sourceValues, type Source } from '@/domain/forum/sourceCatalog';
import { checkForumConnectivity } from './forumConnectivity';
import {
  activeNetworkProxyProfile,
  networkMode,
  readSystemNetworkLabel,
  type NetworkMode
} from '@/platform/network/networkProxy';
import { NetworkProxyScreen } from './components/NetworkProxyScreen';
import { useMoreRouteRuntime, type MoreRouteRuntimeValue } from './MoreRouteRuntime';
import { createMoreScreenStyles } from './styles';

const modeRows: { id: NetworkMode; title: string; description: string }[] = [
  { id: 'system', title: '跟随系统', description: '使用 Android 的网络与 DNS 设置' },
  { id: 'proxy', title: '应用代理', description: '通过已保存的 HTTP 或 SOCKS5 代理连接' }
];

const modeTitle = (mode?: NetworkMode) => modeRows.find((row) => row.id === mode)?.title;
type Runtime = MoreRouteRuntimeValue['proxy'];

function createSettingsStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const font = createUiFontSizer(settings);
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    content: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 32, gap: 22 },
    group: { borderRadius: readerRadii.surface, backgroundColor: theme.surface, overflow: 'hidden' },
    heading: { marginBottom: 8, marginHorizontal: 4, color: theme.muted, fontSize: font(13), fontWeight: '600' },
    status: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
    row: {
      minHeight: 52,
      paddingHorizontal: 16,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12
    },
    rowCopy: { flex: 1, minWidth: 0, gap: 4 },
    divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16, backgroundColor: theme.line },
    title: { color: theme.ink, fontSize: font(15), fontWeight: '600' },
    description: { color: theme.muted, fontSize: font(13), lineHeight: font(19) },
    error: { color: theme.danger, fontSize: font(13), lineHeight: font(19) },
    logToolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      backgroundColor: theme.surface,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    logFilters: { flex: 1, minWidth: 0 },
    logList: { paddingHorizontal: 16, paddingBottom: 24 },
    logDay: { paddingTop: 18, paddingBottom: 6, color: theme.muted, fontWeight: '600', fontSize: font(13) },
    logRow: {
      gap: 4,
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: theme.surface,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    logLine: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
    logSite: { flex: 1, color: theme.ink, fontSize: font(14), fontWeight: '600' },
    logTime: { color: theme.muted, fontSize: font(12), fontVariant: ['tabular-nums'] },
    logFeedback: { marginHorizontal: 16, marginTop: 10 },

    logResult: { flexShrink: 1, textAlign: 'right' }
  });
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { styles } = useReaderThemeStyles(createSettingsStyles);
  return (
    <View>
      <Text accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
      <View style={styles.group}>{children}</View>
    </View>
  );
}

function ChoiceRow({
  title,
  description,
  selected,
  divider,
  disabled = false,
  onPress
}: {
  title: string;
  description?: string;
  selected?: boolean;
  divider?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createSettingsStyles);
  return (
    <>
      {divider && <View style={styles.divider} />}
      <Pressable
        accessibilityRole={selected === undefined ? 'button' : 'radio'}
        accessibilityState={selected === undefined ? { disabled } : { checked: selected, disabled }}
        disabled={disabled}
        onPress={onPress}
        style={styles.row}
      >
        <View style={styles.rowCopy}>
          <Text style={styles.title}>{title}</Text>
          {description ? <Text style={styles.description}>{description}</Text> : null}
        </View>
        {selected === undefined ? (
          <ChevronRight size={18} color={theme.muted} />
        ) : (
          <View style={{ width: 20 }}>{selected && <Check size={20} color={theme.primary} />}</View>
        )}
      </Pressable>
    </>
  );
}

const logFilters = [
  { value: 'all', label: '全部' },
  { value: 'failed', label: '仅看失败' }
];

function NetworkLogScreen({ focused }: { focused: boolean }) {
  const { styles } = useReaderThemeStyles(createSettingsStyles);
  const [entries, setEntries] = useState<NetworkLogEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => {
    if (!focused) return;
    let current = true;
    setStatus('loading');
    void readNetworkLog().then(
      (rows) => {
        if (current) {
          setEntries(rows);
          setStatus('ready');
        }
      },
      () => {
        if (current) setStatus('error');
      }
    );
    return () => {
      current = false;
    };
  }, [focused, refresh]);
  const visible = (failuresOnly ? entries.filter((entry) => entry.failed) : entries).slice(0, 80);
  const sections: { title: string; data: NetworkLogEntry[] }[] = [];
  for (const entry of visible) {
    const date = new Date(entry.time);
    const title = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
    const last = sections[sections.length - 1];
    if (last?.title === title) last.data.push(entry);
    else sections.push({ title, data: [entry] });
  }
  const copyLog = async () => {
    const lines = visible.map((entry) =>
      [new Date(entry.time).toISOString(), entry.site, entry.stage, entry.result].join(' · ')
    );
    const ok = await Clipboard.setStringAsync(lines.join('\n')).catch(() => false);
    setCopyStatus(ok ? '已复制当前显示的网络日志。' : '复制失败，请重试。');
  };
  return (
    <View style={styles.page}>
      <View style={styles.logToolbar}>
        <View style={styles.logFilters}>
          <PillRail
            items={logFilters}
            variant="subtabs"
            value={failuresOnly ? 'failed' : 'all'}
            onChange={(value) => {
              setFailuresOnly(value === 'failed');
              setCopyStatus('');
            }}
          />
        </View>
        <IconButton
          iconOnly
          icon={RefreshCw}
          label="刷新日志"
          loading={status === 'loading'}
          onPress={() => {
            setCopyStatus('');
            setRefresh((value) => value + 1);
          }}
        />
        <IconButton
          iconOnly
          icon={Copy}
          label="复制日志"
          disabled={!visible.length || status === 'loading'}
          onPress={() => void copyLog()}
        />
      </View>
      {copyStatus ? (
        <Text accessibilityLiveRegion="polite" style={[styles.description, styles.logFeedback]}>
          {copyStatus}
        </Text>
      ) : null}
      {status === 'error' ? (
        <Text accessibilityRole="alert" style={[styles.error, styles.logFeedback]}>
          暂时无法读取网络日志，请刷新重试。
        </Text>
      ) : null}
      <SectionList
        sections={sections}
        contentContainerStyle={styles.logList}
        stickySectionHeadersEnabled={false}
        keyExtractor={(entry, index) => `${entry.time}-${entry.site}-${entry.stage}-${index}`}
        renderSectionHeader={({ section }) => (
          <Text accessibilityRole="header" style={styles.logDay}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <View style={styles.logRow}>
            <View style={styles.logLine}>
              <Text style={styles.logSite}>
                {item.site} · {item.stage}
              </Text>
              <Text style={styles.logTime}>{new Date(item.time).toTimeString().slice(0, 8)}</Text>
            </View>
            <Text style={item.failed ? styles.error : styles.description}>{item.result}</Text>
          </View>
        )}
        ListEmptyComponent={
          status === 'ready' ? (
            <Text style={[styles.description, styles.logDay]}>
              {failuresOnly ? '最近没有失败记录。' : '还没有网络记录。访问论坛后可在这里查看。'}
            </Text>
          ) : null
        }
        ListFooterComponent={visible.length === 80 ? <Text style={styles.logDay}>显示最近 80 条记录</Text> : null}
      />
    </View>
  );
}

function ConnectivityTest({ fetcher, routeLabel }: { fetcher: Runtime['networkProxyFetcher']; routeLabel: string }) {
  const { styles } = useReaderThemeStyles(createSettingsStyles);
  const request = useRef<AbortController | null>(null);
  const [results, setResults] = useState<Partial<Record<Source, Awaited<ReturnType<typeof checkForumConnectivity>>>>>();
  useEffect(() => () => request.current?.abort(), []);
  const test = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setResults({});
    await Promise.all(
      sourceValues.map(async (source) => {
        const result = await checkForumConnectivity(source, fetcher, controller.signal);
        if (!controller.signal.aborted) setResults((previous) => ({ ...previous, [source]: result }));
      })
    );
    request.current = null;
  };
  const testing = !!results && sourceValues.some((source) => !results[source]);
  return (
    <Section title="连通性测试">
      <ChoiceRow
        title={testing ? '正在测试当前网络' : '测试当前网络'}
        description={routeLabel}
        disabled={testing}
        onPress={() => void test()}
      />
      {results &&
        sourceValues.map((source) => {
          const result = results[source];
          return (
            <View key={source}>
              <View style={styles.divider} />
              <View style={styles.row}>
                <Text style={[styles.title, styles.rowCopy]}>{sourceCatalog[source].label}</Text>
                <Text
                  accessibilityLiveRegion="polite"
                  style={[result?.failed ? styles.error : styles.description, styles.logResult]}
                >
                  {result ? `${result.message} · ${result.latencyMs} ms` : '测试中'}
                </Text>
              </View>
            </View>
          );
        })}
    </Section>
  );
}

function NetworkSettingsOverview({
  runtime,
  focused,
  openProfiles,
  openLog,
  openVerification
}: {
  runtime: Runtime;
  focused: boolean;
  openProfiles: () => void;
  openLog: () => void;
  openVerification?: () => void;
}) {
  const { styles } = useReaderThemeStyles(createSettingsStyles);
  const [systemNetwork, setSystemNetwork] = useState<string>();
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const update = () => {
        void readSystemNetworkLabel().then((label) => {
          if (active) setSystemNetwork(label);
        });
      };
      update();
      const sub = AppState.addEventListener('focus', update);
      return () => {
        active = false;
        sub.remove();
      };
    }, [])
  );
  const [changingMode, setChangingMode] = useState(false);
  const [feedback, setFeedback] = useState('');
  const applying = runtime.applyStatus === 'applying' || changingMode;
  const loading = runtime.applyStatus === 'loading';
  const shownState = loading ? undefined : applying ? runtime.confirmedState : runtime.proxyState;
  const selected = shownState ? networkMode(shownState) : undefined;
  const profile = shownState && activeNetworkProxyProfile(shownState);
  const busy = applying || loading;
  const choose = async (mode: NetworkMode) => {
    if (busy) return;
    if (selected === mode && runtime.applyStatus !== 'failed') return;
    if (mode === 'proxy' && !runtime.activeProfile) return openProfiles();
    setChangingMode(true);
    try {
      await runtime.setNetworkMode(mode);
      setFeedback('');
    } catch (error) {
      setFeedback(errorMessage(error));
    } finally {
      setChangingMode(false);
    }
  };
  const effective = modeTitle(runtime.effectiveMode);
  const statusTitle =
    !applying && runtime.applyStatus === 'failed' ? '连接状态待确认' : (effective ?? '正在读取网络设置');
  const applyError = applying ? '' : runtime.applyError || feedback;
  const ready = !applying && (runtime.applyStatus === 'applied' || runtime.applyStatus === 'disabled');
  const routeLabel =
    runtime.effectiveMode === 'proxy' && profile ? `${profile.protocol.toUpperCase()} · ${profile.name}` : '跟随系统';

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} testID="network-settings">
      <Section title="当前网络">
        <View accessibilityLiveRegion="polite" style={styles.status}>
          <View style={styles.rowCopy}>
            <Text style={styles.title}>{statusTitle}</Text>
            {systemNetwork ? <Text style={styles.description}>系统网络 · {systemNetwork}</Text> : null}
          </View>
          {applying ? <Text style={styles.description}>正在应用</Text> : null}
        </View>
      </Section>
      <Section title="网络模式">
        {modeRows.map((row, index) => (
          <ChoiceRow
            key={row.id}
            divider={index > 0}
            title={row.title}
            description={row.description}
            selected={selected === row.id}
            disabled={busy}
            onPress={() => void choose(row.id)}
          />
        ))}
      </Section>
      {selected === 'proxy' ? (
        <Section title="应用代理">
          <ChoiceRow title="管理代理" description={profile?.name} disabled={busy} onPress={openProfiles} />
        </Section>
      ) : null}
      {focused && ready && (
        <ConnectivityTest
          key={profile && selected === 'proxy' ? profile.id : 'system'}
          fetcher={runtime.networkProxyFetcher}
          routeLabel={routeLabel}
        />
      )}
      {applyError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {applyError}
        </Text>
      ) : null}
      <Section title="诊断">
        {openVerification && ready && <ChoiceRow title="打开网站验证页" onPress={openVerification} />}
        <ChoiceRow
          divider={!!openVerification && ready}
          title="网络日志"
          description="查看 DNS、TLS、HTTP 和账号资料的读取结果"
          onPress={openLog}
        />
      </Section>
    </ScrollView>
  );
}

export function NetworkSettingsRoute({
  navigation,
  route
}: NativeStackScreenProps<RootStackParamList, 'NetworkSettings'>) {
  const { account, proxy } = useMoreRouteRuntime();
  const focused = useIsFocused();
  const { styles, theme } = useReaderThemeStyles(createMoreScreenStyles);
  const close = () => {
    if (!navigation.isFocused()) return false;
    navigation.goBack();
    return true;
  };
  if (route.params?.page === 'proxies') {
    return (
      <NetworkProxyScreen
        active={focused}
        applyError={proxy.applyError}
        applyStatus={proxy.applyStatus}
        confirmedState={proxy.confirmedState}
        proxyState={proxy.proxyState}
        styles={styles}
        theme={theme}
        onClose={close}
        onDeleteProfile={proxy.deleteProxyProfile}
        onSelectProfile={proxy.selectProxyProfile}
        onUpsertProfile={async (profile) => {
          await proxy.upsertProxyProfile(profile);
          if (networkMode(proxy.proxyState) !== 'proxy') {
            await proxy.selectProxyProfile(profile.id);
            await proxy.setNetworkMode('proxy');
            close();
          }
        }}
      />
    );
  }
  if (route.params?.page === 'log') return <NetworkLogScreen focused={focused} />;
  return (
    <NetworkSettingsOverview
      runtime={proxy}
      focused={focused}
      openProfiles={() => navigation.push('NetworkSettings', { page: 'proxies' })}
      openLog={() => navigation.push('NetworkSettings', { page: 'log' })}
      openVerification={
        account.enabledSessionSources.includes('linuxdo')
          ? () => void account.center.command({ type: 'open-linuxdo-verification' })
          : undefined
      }
    />
  );
}
