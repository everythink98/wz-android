import type { MoreStyles } from '../styles';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { ArrowLeft, Check, Info, Trash2, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppButton } from '@/ui/controls/ButtonControls';
import { EmptyText } from '@/ui/controls/FeedbackStates';
import { SettingRail } from '@/ui/controls/SelectionControls';
import { ModalSheetFrame } from '@/ui/controls/ModalSheetFrame';
import { androidRipple, type ReaderTheme } from '@/ui/theme/tokens';
import {
  createNetworkProxyProfile,
  validateNetworkProxyProfile,
  type NetworkProxyProfile,
  type NetworkProxyProtocol,
  type NetworkProxyState,
  type NetworkProxyStatus
} from '@/platform/network/networkProxy';
import { errorMessage } from '@/platform/network/errors';

type Draft = {
  id?: string;
  name: string;
  protocol: NetworkProxyProtocol;
  host: string;
  port: string;
  username: string;
  password: string;
};

const emptyDraft: Draft = {
  name: '',
  protocol: 'socks5',
  host: '',
  port: '',
  username: '',
  password: ''
};

function draftFromProfile(profile: NetworkProxyProfile): Draft {
  return {
    id: profile.id,
    name: profile.name,
    protocol: profile.protocol,
    host: profile.host,
    port: String(profile.port),
    username: profile.username || '',
    password: profile.password || ''
  };
}

function profileFromDraft(draft: Draft) {
  return createNetworkProxyProfile({
    id: draft.id,
    name: draft.name,
    protocol: draft.protocol,
    host: draft.host,
    port: Number(draft.port),
    username: draft.username,
    password: draft.password
  });
}

function protocolLabel(protocol: NetworkProxyProtocol) {
  return protocol === 'socks5' ? 'SOCKS5' : 'HTTP';
}

export function NetworkProxyModal({
  activeProfile,
  applyError,
  applyStatus,
  proxyState,
  styles,
  theme,
  visible,
  onClose,
  onDeleteProfile,
  onSelectProfile,
  onSetEnabled,
  onTestProfile,
  onUpsertProfile
}: {
  activeProfile: NetworkProxyProfile | null;
  applyError: string;
  applyStatus: string;
  proxyState: NetworkProxyState;
  styles: MoreStyles;
  theme: ReaderTheme;
  visible: boolean;
  onClose: () => void;
  onDeleteProfile: (id: string) => Promise<void>;
  onSelectProfile: (id: string) => Promise<void>;
  onSetEnabled: (enabled: boolean) => Promise<void>;
  onTestProfile: (profile: NetworkProxyProfile) => Promise<NetworkProxyStatus>;
  onUpsertProfile: (profile: NetworkProxyProfile) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [draftMode, setDraftMode] = useState<'create' | 'edit' | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [draftKeyboardInset, setDraftKeyboardInset] = useState(0);
  const switchProgress = useRef(new Animated.Value(proxyState.enabled ? 1 : 0)).current;
  const draftProfile = useMemo(() => profileFromDraft(draft), [draft]);
  const errors = useMemo(() => validateNetworkProxyProfile(draftProfile), [draftProfile]);
  const visibleErrors = submitted ? errors : {};
  const selecting = selectedIds.length > 0;
  const displayedEnabled = pendingEnabled ?? proxyState.enabled;
  const switchDisabled = busy || applyStatus === 'applying';
  const switchTranslateX = switchProgress.interpolate({ inputRange: [0, 1], outputRange: [0, 28] });
  const accentBaseColor = '#1677FF';
  const accentColor = theme.primary;
  const accentSoftColor = theme.primarySoft;
  const accentBorderColor = theme.line;
  const cardColor = theme.surface;
  const pageColor = theme.background;

  useEffect(() => {
    if (!visible) {
      setDraft(emptyDraft);
      setDraftMode(null);
      setSubmitted(false);
      setBusy(false);
      setTestingId(null);
      setPendingEnabled(null);
      setSelectedIds([]);
      setDraftKeyboardInset(0);
    }
  }, [visible]);

  useEffect(() => {
    if (draftMode === null) {
      setDraftKeyboardInset(0);
      return;
    }
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => {
      setDraftKeyboardInset(Math.max(0, event.endCoordinates.height - insets.bottom));
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      Keyboard.dismiss();
      setDraftKeyboardInset(0);
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [draftMode, insets.bottom]);

  useEffect(() => {
    if (pendingEnabled !== null && proxyState.enabled === pendingEnabled && applyStatus !== 'applying') {
      setPendingEnabled(null);
    }
  }, [applyStatus, pendingEnabled, proxyState.enabled]);

  useEffect(() => {
    Animated.timing(switchProgress, {
      duration: 160,
      easing: Easing.out(Easing.cubic),
      toValue: displayedEnabled ? 1 : 0,
      useNativeDriver: true
    }).start();
  }, [displayedEnabled, switchProgress]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => proxyState.profiles.some((profile) => profile.id === id)));
  }, [proxyState.profiles]);

  const executeProxyTask = async <T,>(task: () => Promise<T>) => {
    if (busy) {
      return { ok: false } as const;
    }
    setBusy(true);
    try {
      return { ok: true, value: await task() } as const;
    } catch (error) {
      Alert.alert('服务器代理', errorMessage(error));
      return { ok: false } as const;
    } finally {
      setBusy(false);
    }
  };

  const closeDraft = () => {
    if (busy) {
      return;
    }
    Keyboard.dismiss();
    setDraft(emptyDraft);
    setDraftMode(null);
    setSubmitted(false);
    setDraftKeyboardInset(0);
  };

  const saveDraft = async () => {
    setSubmitted(true);
    if (Object.keys(errors).length) {
      return;
    }
    const result = await executeProxyTask(() => onUpsertProfile(draftProfile));
    if (!result.ok) {
      return;
    }
    setTestResults((current) => {
      const { [draftProfile.id]: _removed, ...rest } = current;
      return rest;
    });
    Keyboard.dismiss();
    setDraft(emptyDraft);
    setDraftMode(null);
    setSubmitted(false);
    setDraftKeyboardInset(0);
  };

  const openCreate = () => {
    setDraft(emptyDraft);
    setSubmitted(false);
    setDraftMode('create');
  };

  const openEdit = (profile: NetworkProxyProfile) => {
    setDraft(draftFromProfile(profile));
    setSubmitted(false);
    setDraftMode('edit');
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const chooseProfile = (profile: NetworkProxyProfile) => {
    if (selecting) {
      toggleSelected(profile.id);
      return;
    }
    if (profile.id !== proxyState.activeId) {
      void executeProxyTask(() => onSelectProfile(profile.id));
    }
  };

  const toggleEnabled = async (enabled: boolean) => {
    if (busy || applyStatus === 'applying' || enabled === displayedEnabled) {
      return;
    }
    if (enabled && !activeProfile) {
      await executeProxyTask(() => onSetEnabled(enabled));
      return;
    }
    setPendingEnabled(enabled);
    const result = await executeProxyTask(() => onSetEnabled(enabled));
    if (!result.ok) {
      setPendingEnabled(null);
    }
  };

  const testProfile = async (profile: NetworkProxyProfile) => {
    if (busy) {
      return;
    }
    setTestingId(profile.id);
    try {
      const result = await executeProxyTask(() => onTestProfile(profile));
      if (result.ok) {
        setTestResults((current) => ({
          ...current,
          [profile.id]: `${result.value.latencyMs} ms`
        }));
      }
    } finally {
      setTestingId(null);
    }
  };

  const deleteSelectedProfiles = () => {
    Alert.alert('删除代理', `确定删除选中的 ${selectedIds.length} 个代理？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          const result = await executeProxyTask(async () => {
            for (const id of selectedIds) {
              await onDeleteProfile(id);
            }
          });
          if (result.ok) {
            setSelectedIds([]);
          }
        }
      }
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={selecting ? () => setSelectedIds([]) : onClose}>
      <View
        style={[
          styles.loginWebViewModal,
          { backgroundColor: pageColor, paddingTop: insets.top, paddingBottom: insets.bottom }
        ]}
      >
        <View style={[styles.loginWebViewHeader, proxyStyles.header, { backgroundColor: theme.background }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={selecting ? '取消选择' : '返回'}
            android_ripple={androidRipple(theme.primarySoft, true)}
            style={proxyStyles.headerIcon}
            onPress={selecting ? () => setSelectedIds([]) : onClose}
          >
            {selecting ? (
              <X size={24} color={theme.ink} strokeWidth={2.2} />
            ) : (
              <ArrowLeft size={24} color={theme.ink} strokeWidth={2.2} />
            )}
          </Pressable>
          <Text style={[styles.loginWebViewTitle, proxyStyles.headerTitle]} numberOfLines={1}>
            {selecting ? selectedIds.length : '服务器代理'}
          </Text>
          {selecting ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="删除选中的代理"
              android_ripple={androidRipple(theme.primarySoft, true)}
              disabled={busy}
              style={proxyStyles.headerIcon}
              onPress={deleteSelectedProfiles}
            >
              <Trash2 size={23} color={theme.ink} strokeWidth={2} />
            </Pressable>
          ) : (
            <View style={proxyStyles.headerIcon} />
          )}
        </View>
        {applyError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{applyError}</Text>
            {applyStatus === 'failed' ? (
              <AppButton
                compact
                disabled={busy}
                label="重置为直连"
                variant="ghost"
                styles={styles}
                onPress={() => {
                  void executeProxyTask(() => onSetEnabled(false));
                }}
              />
            ) : null}
          </View>
        ) : null}
        <ScrollView style={[styles.flex, { backgroundColor: pageColor }]} contentContainerStyle={proxyStyles.content}>
          <View style={[proxyStyles.card, proxyStyles.switchCard, { backgroundColor: cardColor }]}>
            <Text style={[proxyStyles.switchLabel, { color: theme.ink }]}>使用代理</Text>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: displayedEnabled, disabled: switchDisabled }}
              disabled={switchDisabled}
              hitSlop={8}
              style={[
                proxyStyles.toggleTrack,
                {
                  backgroundColor: displayedEnabled ? accentBaseColor : theme.lineStrong,
                  opacity: switchDisabled ? 0.72 : 1
                }
              ]}
              onPress={() => toggleEnabled(!displayedEnabled)}
            >
              <Animated.View
                style={[
                  proxyStyles.toggleThumb,
                  { backgroundColor: theme.surface, transform: [{ translateX: switchTranslateX }] }
                ]}
              />
            </Pressable>
          </View>

          <View style={[proxyStyles.card, { backgroundColor: cardColor }]}>
            <Text style={[proxyStyles.cardTitle, { color: accentColor }]}>代理连接</Text>
            {!proxyState.profiles.length ? <EmptyText text="还没有代理配置" styles={styles} /> : null}
            {proxyState.profiles.map((profile) => {
              const active = profile.id === proxyState.activeId;
              const latency = testResults[profile.id];
              const selected = selectedIds.includes(profile.id);
              const activeApplying = active && (applyStatus === 'applying' || pendingEnabled !== null);
              const activeDisplayedEnabled = active && displayedEnabled;
              let status = `${protocolLabel(profile.protocol)}${profile.username ? ' · 已填写账号' : ''}`;
              if (active) {
                status = '已选择，未开启';
              }
              if (activeDisplayedEnabled) {
                status = applyStatus === 'failed' ? '代理异常' : `已连接${latency ? `, 连通性: ${latency}` : ''}`;
              }
              if (activeApplying) {
                status = displayedEnabled ? '正在开启代理...' : '正在关闭代理...';
              }
              if (testingId === profile.id) {
                status = '正在测试连通性...';
              }
              const canTestLatency =
                !selecting && testingId !== profile.id && applyStatus !== 'applying' && pendingEnabled === null;
              const statusText = canTestLatency
                ? activeDisplayedEnabled
                  ? `✓ ${status}`
                  : `${status}${latency ? ` · 连通性: ${latency}` : ' · 连通性测试'}`
                : status;
              return (
                <Pressable
                  key={profile.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active || selected }}
                  android_ripple={androidRipple(theme.primarySoft)}
                  style={[proxyStyles.proxyRow, active && !selecting && { backgroundColor: accentSoftColor }]}
                  onLongPress={() => setSelectedIds([profile.id])}
                  onPress={() => chooseProfile(profile)}
                >
                  {selecting ? (
                    <View
                      style={[
                        proxyStyles.checkCircle,
                        { borderColor: theme.lineStrong },
                        selected && { backgroundColor: accentBaseColor, borderColor: accentBaseColor }
                      ]}
                    >
                      {selected ? <Check size={13} color={theme.onPrimary} strokeWidth={2.4} /> : null}
                    </View>
                  ) : null}
                  <View style={styles.flex}>
                    <View style={proxyStyles.addressLine}>
                      <Text style={[proxyStyles.proxyAddress, { color: theme.ink }]} numberOfLines={1}>
                        {profile.name}
                      </Text>
                      {active ? (
                        <View
                          style={[
                            proxyStyles.currentBadge,
                            { backgroundColor: accentSoftColor, borderColor: accentBorderColor }
                          ]}
                        >
                          <Text style={[proxyStyles.currentBadgeText, { color: accentColor }]}>当前</Text>
                        </View>
                      ) : null}
                    </View>
                    {canTestLatency ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="测试代理连通性"
                        disabled={busy}
                        style={proxyStyles.statusHit}
                        onPress={(event) => {
                          event.stopPropagation();
                          testProfile(profile);
                        }}
                      >
                        <Text style={[styles.meta, { color: accentColor }]} numberOfLines={1}>
                          {profile.host}:{profile.port} · {statusText}
                        </Text>
                      </Pressable>
                    ) : (
                      <Text
                        style={[styles.meta, activeApplying || activeDisplayedEnabled ? { color: accentColor } : null]}
                        numberOfLines={1}
                      >
                        {profile.host}:{profile.port} · {statusText}
                      </Text>
                    )}
                  </View>
                  {!selecting ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="编辑代理"
                      android_ripple={androidRipple(theme.primarySoft, true)}
                      style={proxyStyles.infoButton}
                      onPress={() => openEdit(profile)}
                    >
                      <Info size={21} color={theme.muted} strokeWidth={1.8} />
                    </Pressable>
                  ) : null}
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="button"
              android_ripple={androidRipple(theme.primarySoft)}
              disabled={busy}
              style={[proxyStyles.addRow, { borderTopColor: theme.line }]}
              onPress={openCreate}
            >
              <Text style={[proxyStyles.addRowText, { color: theme.ink }]}>添加代理</Text>
            </Pressable>
          </View>
        </ScrollView>
        <ModalSheetFrame
          backdropLabel="关闭代理表单"
          bottomInset={draftKeyboardInset}
          keyboardAvoiding={false}
          visible={draftMode !== null}
          onRequestClose={closeDraft}
        >
          <View style={styles.searchFilterHeader}>
            <Text style={styles.searchFilterTitle}>{draftMode === 'edit' ? '编辑代理' : '新增代理'}</Text>
          </View>
          <ScrollView
            style={styles.searchFilterBody}
            contentContainerStyle={[styles.searchFilterBodyInner, proxyStyles.sheetBody]}
            keyboardShouldPersistTaps="handled"
          >
            <SettingRail
              title="类型"
              items={[
                { value: 'http', label: 'HTTP' },
                { value: 'socks5', label: 'SOCKS5' }
              ]}
              value={draft.protocol}
              styles={styles}
              onChange={(value) => setDraft((current) => ({ ...current, protocol: value as NetworkProxyProtocol }))}
            />
            <ProxyInput
              label="名称"
              value={draft.name}
              error={visibleErrors.name}
              styles={styles}
              theme={theme}
              onChangeText={(name) => setDraft((current) => ({ ...current, name }))}
            />
            <View style={proxyStyles.fieldRow}>
              <ProxyInput
                label="服务器"
                value={draft.host}
                error={visibleErrors.host}
                styles={styles}
                theme={theme}
                autoCapitalize="none"
                style={proxyStyles.fieldMain}
                onChangeText={(host) => setDraft((current) => ({ ...current, host }))}
              />
              <ProxyInput
                label="端口"
                value={draft.port}
                error={visibleErrors.port}
                styles={styles}
                theme={theme}
                keyboardType="number-pad"
                style={proxyStyles.portField}
                onChangeText={(port) => setDraft((current) => ({ ...current, port }))}
              />
            </View>
            <View style={proxyStyles.fieldRow}>
              <ProxyInput
                label="用户名"
                value={draft.username}
                error={visibleErrors.username}
                styles={styles}
                theme={theme}
                autoCapitalize="none"
                placeholder="可空"
                style={proxyStyles.fieldMain}
                onChangeText={(username) => setDraft((current) => ({ ...current, username }))}
              />
              <ProxyInput
                label="密码"
                value={draft.password}
                error={visibleErrors.password}
                styles={styles}
                theme={theme}
                autoCapitalize="none"
                placeholder="可空"
                secureTextEntry
                style={proxyStyles.fieldMain}
                onChangeText={(password) => setDraft((current) => ({ ...current, password }))}
              />
            </View>
          </ScrollView>
          <View style={styles.searchFilterActions}>
            <AppButton compact label="取消" variant="ghost" styles={styles} disabled={busy} onPress={closeDraft} />
            <AppButton
              compact
              label={busy ? '保存中' : '确定'}
              variant="primary"
              styles={styles}
              disabled={busy}
              onPress={saveDraft}
            />
          </View>
        </ModalSheetFrame>
      </View>
    </Modal>
  );
}

function ProxyInput({
  autoCapitalize,
  error,
  keyboardType,
  label,
  placeholder,
  secureTextEntry,
  style,
  styles,
  theme,
  value,
  onChangeText
}: {
  autoCapitalize?: 'none';
  error?: string;
  keyboardType?: 'number-pad';
  label: string;
  placeholder?: string;
  secureTextEntry?: boolean;
  style?: object;
  styles: MoreStyles;
  theme: ReaderTheme;
  value: string;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={[styles.stack, style]}>
      <Text style={styles.panelTitle}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize={autoCapitalize}
        autoComplete={secureTextEntry ? 'current-password' : undefined}
        autoCorrect={false}
        keyboardType={keyboardType}
        placeholder={placeholder || label}
        placeholderTextColor={theme.muted}
        secureTextEntry={secureTextEntry}
        style={styles.input}
        textContentType={secureTextEntry ? 'password' : undefined}
        value={value}
        onChangeText={onChangeText}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const proxyStyles = StyleSheet.create({
  content: {
    gap: 8,
    padding: 16
  },
  header: {
    borderBottomWidth: 0,
    minHeight: 62
  },
  headerIcon: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40
  },
  headerTitle: {
    flex: 1,
    marginHorizontal: 8
  },
  card: {
    borderRadius: 10,
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  switchCard: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 62
  },
  switchLabel: {
    fontSize: 17,
    fontWeight: '600'
  },
  toggleTrack: {
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    padding: 2,
    width: 64
  },
  toggleThumb: {
    borderRadius: 16,
    elevation: 3,
    height: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.16,
    shadowRadius: 2,
    width: 32
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 12
  },
  proxyRow: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: -10,
    minHeight: 60,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  checkCircle: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.5,
    height: 28,
    justifyContent: 'center',
    width: 28
  },
  proxyAddress: {
    flexShrink: 1,
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 23
  },
  addressLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minWidth: 0
  },
  currentBadge: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 7,
    paddingVertical: 2
  },
  currentBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14
  },
  statusHit: {
    alignSelf: 'flex-start',
    minHeight: 28,
    justifyContent: 'center',
    paddingRight: 10
  },
  infoButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36
  },
  addRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 50,
    paddingVertical: 12
  },
  addRowText: {
    fontSize: 16,
    fontWeight: '600'
  },
  sheetBody: {
    gap: 12
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 10
  },
  fieldMain: {
    flex: 1,
    minWidth: 0
  },
  portField: {
    width: 112
  }
});
