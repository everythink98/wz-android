import { useState, type ReactNode } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, ChevronRight } from 'lucide-react-native';
import { AppButton } from '@/ui/controls/ButtonControls';
import { AppTextInput } from '@/ui/controls/InputControls';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { createReaderFontSizer, readerRadii, type ReaderStyleSettings, type ReaderTheme } from '@/ui/theme/tokens';
import { errorMessage } from '@/platform/network/errors';
import {
  encryptedDnsProviderLabel,
  encryptedDnsProviders,
  normalizeEncryptedDnsSettings,
  type EncryptedDnsProvider,
  type EncryptedDnsSettings
} from '@/platform/network/encryptedDns';
import { activeNetworkProxyProfile, networkMode, type NetworkMode } from '@/platform/network/networkProxy';
import { NetworkProxyScreen } from './components/NetworkProxyScreen';
import { useMoreRouteRuntime, type MoreRouteRuntimeValue } from './MoreRouteRuntime';
import { createMoreScreenStyles } from './styles';

const modeRows: { id: NetworkMode; title: string; description: string }[] = [
  { id: 'system', title: '跟随系统', description: '使用 Android 的网络与 DNS 设置' },
  { id: 'doh', title: '加密 DNS', description: '通过 HTTPS 解析阅坛内访问的域名' },
  { id: 'proxy', title: '应用代理', description: '通过已保存的 HTTP 或 SOCKS5 代理连接' }
];

const modeTitle = (mode?: NetworkMode) => modeRows.find((row) => row.id === mode)?.title;
type Runtime = MoreRouteRuntimeValue['proxy'];

function createSettingsStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const font = createReaderFontSizer(settings);
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    content: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 32, gap: 22 },
    group: { borderRadius: readerRadii.surface, backgroundColor: theme.surface, overflow: 'hidden' },
    heading: { marginBottom: 8, marginHorizontal: 4, color: theme.muted, fontSize: font(13), fontWeight: '600' },
    status: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
    statusTitle: { flex: 1, lineHeight: font(21) },
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
    field: { gap: 8 },
    input: {
      color: theme.ink,
      backgroundColor: theme.surface,
      padding: 12,
      borderRadius: readerRadii.control,
      fontSize: font(15)
    },
    actions: { gap: 10 }
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

function DnsProviderForm({ runtime, goBack }: { runtime: Runtime; goBack: () => boolean }) {
  const { styles, theme } = useReaderThemeStyles(createSettingsStyles);
  const saved = runtime.proxyState.encryptedDns;
  const [provider, setProvider] = useState<EncryptedDnsProvider | undefined>(saved?.provider);
  const [policy, setPolicy] = useState<EncryptedDnsSettings['policy']>(saved?.policy ?? 'prefer');
  const [endpoint, setEndpoint] = useState(saved?.customEndpoint ?? '');
  const [bootstrap, setBootstrap] = useState(saved?.customBootstrap?.join(', ') ?? '');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');
  const unchanged =
    runtime.effectiveMode === 'doh' &&
    runtime.applyStatus === 'applied' &&
    provider === saved?.provider &&
    policy === saved?.policy &&
    (provider !== 'custom' ||
      (endpoint === (saved?.customEndpoint ?? '') && bootstrap === (saved?.customBootstrap?.join(', ') ?? '')));
  const save = async () => {
    if (saving) return;
    if (unchanged) {
      goBack();
      return;
    }
    try {
      const settings = normalizeEncryptedDnsSettings({
        provider,
        policy,
        customEndpoint: provider === 'custom' ? endpoint : saved?.customEndpoint,
        customBootstrap: provider === 'custom' ? bootstrap.split(/[,，\s]+/).filter(Boolean) : saved?.customBootstrap
      });
      setSaving(true);
      await runtime.setNetworkMode('doh', settings);
      if (!goBack()) setSaving(false);
    } catch (error) {
      setFailure(errorMessage(error));
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Section title="服务商">
        {encryptedDnsProviders.map((item, index) => (
          <ChoiceRow
            key={item.id}
            divider={index > 0}
            title={item.label}
            description={
              item.id === 'auto'
                ? '按各论坛的 HTTPS 直连结果选择，连不上时切换'
                : item.id === 'cfluxdo'
                  ? '使用作者公开的加密 DNS 服务'
                  : undefined
            }
            selected={provider === item.id}
            disabled={saving}
            onPress={() => {
              setFailure('');
              setProvider(item.id);
            }}
          />
        ))}
      </Section>
      {provider === 'custom' && (
        <View style={styles.field}>
          <Text style={styles.title}>HTTPS 地址</Text>
          <AppTextInput
            accessibilityLabel="HTTPS 地址"
            value={endpoint}
            editable={!saving}
            onChangeText={setEndpoint}
            placeholder="https://example.org/dns-query"
            placeholderTextColor={theme.muted}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.title}>引导 IP（可选）</Text>
          <AppTextInput
            accessibilityLabel="引导 IP"
            value={bootstrap}
            editable={!saving}
            onChangeText={setBootstrap}
            placeholder="多个地址用逗号分隔"
            placeholderTextColor={theme.muted}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      )}
      <Section title="保护级别">
        <ChoiceRow
          title="优先 DoH"
          description="解析服务不可用时允许回退"
          selected={policy === 'prefer'}
          disabled={saving}
          onPress={() => setPolicy('prefer')}
        />
        <ChoiceRow
          title="仅 DoH"
          description="解析失败或与系统代理冲突时，显示错误"
          divider
          selected={policy === 'strict'}
          disabled={saving}
          onPress={() => setPolicy('strict')}
        />
      </Section>
      {failure ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {failure}
        </Text>
      ) : null}
      <AppButton
        label={unchanged && !saving ? '完成' : '保存并应用'}
        variant="solid"
        disabled={!provider || saving}
        loading={saving}
        onPress={() => void save()}
      />
    </ScrollView>
  );
}

function NetworkSettingsOverview({
  runtime,
  openDns,
  openProfiles
}: {
  runtime: Runtime;
  openDns: () => void;
  openProfiles: () => void;
}) {
  const { styles } = useReaderThemeStyles(createSettingsStyles);
  const [action, setAction] = useState<'apply' | 'test'>();
  const [feedback, setFeedback] = useState<
    | { kind: 'apply-error'; text: string }
    | { kind: 'result' | 'test-error'; settings: EncryptedDnsSettings; text: string }
  >();
  const applying = runtime.applyStatus === 'applying' || action === 'apply';
  const loading = runtime.applyStatus === 'loading';
  const shownState = loading ? undefined : applying ? runtime.confirmedState : runtime.proxyState;
  const selected = shownState ? networkMode(shownState) : undefined;
  const dns = shownState?.encryptedDns;
  const profile = shownState && activeNetworkProxyProfile(shownState);
  const busy = applying || loading || action === 'test';
  const choose = async (mode: NetworkMode) => {
    if (busy) return;
    if (selected === mode && runtime.applyStatus !== 'failed') return;
    if (mode === 'doh' && !dns) return openDns();
    if (mode === 'proxy' && !runtime.activeProfile) return openProfiles();
    setAction('apply');
    try {
      await runtime.setNetworkMode(mode);
      setFeedback(undefined);
    } catch (error) {
      setFeedback({ kind: 'apply-error', text: errorMessage(error) });
    } finally {
      setAction(undefined);
    }
  };
  const test = async () => {
    if (busy || !dns) return;
    setAction('test');
    try {
      const status = await runtime.testEncryptedDns(dns);
      const provider = encryptedDnsProviderLabel(status.dnsProvider);
      setFeedback({
        kind: 'result',
        settings: dns,
        text: status.message ?? `LINUX DO 首页直连通过 · ${status.latencyMs ?? 0} ms${provider ? ` · ${provider}` : ''}`
      });
    } catch (error) {
      setFeedback({ kind: 'test-error', settings: dns, text: errorMessage(error) });
    } finally {
      setAction(undefined);
    }
  };
  const effective = modeTitle(runtime.effectiveMode);
  const statusTitle =
    !applying && runtime.applyStatus === 'failed' ? '连接状态待确认' : (effective ?? '正在读取网络设置');
  const applyError = applying ? '' : runtime.applyError || (feedback?.kind === 'apply-error' ? feedback.text : '');
  const testResult = feedback && feedback.kind !== 'apply-error' && feedback.settings === dns ? feedback : undefined;

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} testID="network-settings">
      <Section title="当前网络">
        <View accessibilityLiveRegion="polite" style={styles.status}>
          <Text style={[styles.title, styles.statusTitle]}>{statusTitle}</Text>
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
      {selected === 'doh' && dns ? (
        <Section title="加密 DNS">
          <ChoiceRow
            title="服务商和保护级别"
            disabled={busy}
            onPress={openDns}
            description={`${encryptedDnsProviders.find((item) => item.id === dns.provider)?.label} · ${dns.policy === 'strict' ? '仅 DoH' : '优先 DoH'}`}
          />
        </Section>
      ) : selected === 'proxy' ? (
        <Section title="应用代理">
          <ChoiceRow title="管理代理" description={profile?.name} disabled={busy} onPress={openProfiles} />
        </Section>
      ) : null}
      {selected === 'doh' && dns ? (
        <View style={styles.actions}>
          <AppButton
            label="测试连接"
            variant="primary"
            disabled={busy}
            loading={action === 'test'}
            onPress={() => void test()}
          />
          {testResult ? (
            <Text
              accessibilityLiveRegion="polite"
              style={testResult.kind === 'test-error' ? styles.error : styles.description}
            >
              {testResult.text}
            </Text>
          ) : null}
          {runtime.dnsResult ? <Text style={styles.description}>{runtime.dnsResult}</Text> : null}
        </View>
      ) : null}
      {applyError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {applyError}
        </Text>
      ) : null}
    </ScrollView>
  );
}

export function NetworkSettingsRoute({
  navigation,
  route
}: NativeStackScreenProps<RootStackParamList, 'NetworkSettings'>) {
  const { proxy } = useMoreRouteRuntime();
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
            await proxy.setNetworkMode('proxy');
            close();
          }
        }}
        onTestProfile={proxy.testProxyProfile}
      />
    );
  }
  if (route.params?.page === 'dns') return <DnsProviderForm runtime={proxy} goBack={close} />;
  return (
    <NetworkSettingsOverview
      runtime={proxy}
      openDns={() => navigation.push('NetworkSettings', { page: 'dns' })}
      openProfiles={() => navigation.push('NetworkSettings', { page: 'proxies' })}
    />
  );
}
