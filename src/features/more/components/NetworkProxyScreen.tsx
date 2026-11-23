import { AppTextInput as TextInput } from '@/ui/controls/InputControls';
import { recordUserInteraction } from '@/platform/network/userPresence';
import type { MoreStyles } from '../styles';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NavigationContext } from '@react-navigation/native';
import {
  Alert,
  BackHandler,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from 'react-native';
import { ArrowLeft, Check, Pencil, Plus, Trash2, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { EmptyText } from '@/ui/controls/FeedbackStates';
import { SettingRail } from '@/ui/controls/SelectionControls';
import { ModalSheetFrame, ModalSheetHeader } from '@/ui/controls/ModalSheetFrame';
import { alphaColor, readerRadii, type ReaderTheme } from '@/ui/theme/tokens';
import {
  createNetworkProxyProfile,
  validateNetworkProxyProfile,
  type NetworkProxyProfile,
  type NetworkProxyProtocol,
  type NetworkProxyState
} from '@/platform/network/networkProxy';
import { errorMessage } from '@/platform/network/errors';

type ProxyOpeningState = { phase: 'closed' } | { phase: 'ready' | 'running'; opening: object };

type Draft = {
  id?: string;
  name: string;
  protocol: NetworkProxyProtocol;
  host: string;
  port: string;
  username: string;
  password: string;
};

type ProxyDraftState =
  | { mode: 'closed' }
  | { mode: 'create'; draft: Draft; submitted: boolean }
  | { mode: 'edit'; draft: ReturnType<typeof draftFromProfile>; submitted: boolean };

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

export function NetworkProxyScreen({
  active,
  applyError,
  applyStatus,
  confirmedState,
  proxyState,
  styles,
  theme,
  onClose,
  onDeleteProfile,
  onSelectProfile,
  onUpsertProfile
}: {
  active: boolean;
  applyError: string;
  applyStatus: string;
  confirmedState?: NetworkProxyState;
  proxyState: NetworkProxyState;
  styles: MoreStyles;
  theme: ReaderTheme;
  onClose: () => void;
  onDeleteProfile: (id: string) => Promise<void>;
  onSelectProfile: (id: string) => Promise<void>;
  onUpsertProfile: (profile: NetworkProxyProfile) => Promise<void>;
}) {
  const navigation = useContext(NavigationContext);
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [draftState, setDraftState] = useState<ProxyDraftState>({ mode: 'closed' });
  const draft = draftState.mode === 'closed' ? emptyDraft : draftState.draft;
  const draftMode = draftState.mode === 'closed' ? null : draftState.mode;
  const submitted = draftState.mode !== 'closed' && draftState.submitted;
  const [busy, setBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [draftKeyboardInset, setDraftKeyboardInset] = useState(0);
  const opening = useMemo(() => (active ? {} : null), [active]);
  const activeOpening = useRef<ProxyOpeningState>(opening ? { phase: 'ready', opening } : { phase: 'closed' });
  const draftProfile = useMemo(() => profileFromDraft(draft), [draft]);
  const errors = useMemo(() => validateNetworkProxyProfile(draftProfile), [draftProfile]);
  const visibleErrors = submitted ? errors : {};
  const selecting = selectedIds.length > 0;
  const applying = applyStatus === 'applying';
  const shownState = applying ? (confirmedState ?? proxyState) : proxyState;
  const accentColor = theme.primary;
  const accentSoftColor = alphaColor(theme.primary, theme.dark ? 0.14 : 0.06);
  const accentBorderColor = alphaColor(theme.primary, theme.dark ? 0.28 : 0.16);
  const cardColor = theme.surface;
  const pageColor = theme.background;
  const updateDraft = (patch: Partial<Omit<Draft, 'id'>>) => {
    setDraftState((current) => {
      if (current.mode === 'closed') return current;
      const draft = { ...current.draft, ...patch };
      return current.mode === 'edit'
        ? { ...current, draft: { ...draft, id: current.draft.id } }
        : { ...current, draft };
    });
  };

  useLayoutEffect(() => {
    activeOpening.current = opening ? { phase: 'ready', opening } : { phase: 'closed' };
    return () => {
      activeOpening.current = { phase: 'closed' };
    };
  }, [opening]);

  useEffect(() => {
    if (!active) {
      setDraftState({ mode: 'closed' });
      setBusy(false);
      setSelectedIds([]);
      setDraftKeyboardInset(0);
    }
  }, [active]);

  useEffect(() => {
    if (!active || !selecting) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (navigation?.isFocused() === false) return false;
      setSelectedIds([]);
      return true;
    });
    return () => back.remove();
  }, [active, navigation, selecting]);

  useEffect(() => {
    if (draftMode === null) {
      setDraftKeyboardInset(0);
      return;
    }
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => {
      // React Native already excludes the system navigation bar from this height.
      setDraftKeyboardInset(Math.max(0, event.endCoordinates.height));
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      Keyboard.dismiss();
      setDraftKeyboardInset(0);
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [draftMode]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => proxyState.profiles.some((profile) => profile.id === id)));
  }, [proxyState.profiles]);

  const executeProxyTask = async (task: () => Promise<void>) => {
    if (
      navigation?.isFocused() === false ||
      !opening ||
      activeOpening.current.phase !== 'ready' ||
      activeOpening.current.opening !== opening
    ) {
      return false;
    }
    const request = { phase: 'running' as const, opening };
    activeOpening.current = request;
    setBusy(true);
    try {
      await task();
      return activeOpening.current === request;
    } catch (error) {
      if (activeOpening.current !== request) return false;
      Alert.alert('服务器代理', errorMessage(error));
      return false;
    } finally {
      if (activeOpening.current === request) {
        activeOpening.current = { phase: 'ready', opening };
        setBusy(false);
      }
    }
  };

  const closeDraft = () => {
    if (busy) {
      return;
    }
    Keyboard.dismiss();
    setDraftState({ mode: 'closed' });
    setDraftKeyboardInset(0);
  };

  const saveDraft = async () => {
    setDraftState((current) => (current.mode === 'closed' ? current : { ...current, submitted: true }));
    if (Object.keys(errors).length) {
      return;
    }
    const result = await executeProxyTask(() => onUpsertProfile(draftProfile));
    if (!result) {
      return;
    }
    Keyboard.dismiss();
    setDraftState({ mode: 'closed' });
    setDraftKeyboardInset(0);
  };

  const openCreate = () => {
    setDraftState({ mode: 'create', draft: { ...emptyDraft, id: createNetworkProxyProfile({}).id }, submitted: false });
  };

  const openEdit = (profile: NetworkProxyProfile) => {
    setDraftState({ mode: 'edit', draft: draftFromProfile(profile), submitted: false });
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

  const deleteProfiles = (ids: readonly string[]) => {
    return executeProxyTask(async () => {
      for (const id of ids) {
        await onDeleteProfile(id);
      }
    });
  };

  const deleteSelectedProfiles = () => {
    Alert.alert('删除代理', `确定删除选中的 ${selectedIds.length} 个代理？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          const result = await deleteProfiles(selectedIds);
          if (result) {
            setSelectedIds([]);
          }
        }
      }
    ]);
  };

  const deleteDraftProfile = () => {
    if (draftState.mode !== 'edit' || !draftState.draft.id) return;
    const targetId = draftState.draft.id;
    const targetName = draftState.draft.name;
    Alert.alert('删除代理', `确定删除代理「${targetName}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          const result = await deleteProfiles([targetId]);
          if (result) {
            Keyboard.dismiss();
            setDraftState({ mode: 'closed' });
            setDraftKeyboardInset(0);
          }
        }
      }
    ]);
  };

  return (
    <View
      testID="network-proxy-settings"
      onTouchStart={recordUserInteraction}
      onTouchMove={recordUserInteraction}
      style={[styles.flex, { backgroundColor: pageColor, paddingTop: insets.top, paddingBottom: insets.bottom }]}
    >
      <View style={[styles.loginWebViewHeader, proxyStyles.header, { backgroundColor: theme.background }]}>
        <IconButton
          ghost
          iconOnly
          icon={selecting ? X : ArrowLeft}
          label={selecting ? '取消选择' : '返回'}
          onPress={selecting ? () => setSelectedIds([]) : onClose}
        />
        <Text style={[styles.loginWebViewTitle, proxyStyles.headerTitle]} numberOfLines={1}>
          {selecting ? selectedIds.length : '管理代理'}
        </Text>
        {selecting ? (
          <IconButton
            ghost
            iconOnly
            icon={Trash2}
            label="删除选中的代理"
            disabled={busy}
            onPress={deleteSelectedProfiles}
          />
        ) : (
          <View style={proxyStyles.headerIcon} />
        )}
      </View>
      {applyError ? (
        <View style={[styles.errorBox, proxyStyles.errorBanner]}>
          <Text style={[styles.errorText, styles.flex]}>{applyError}</Text>
        </View>
      ) : null}
      <ScrollView
        overScrollMode="never"
        style={[styles.flex, { backgroundColor: pageColor }]}
        contentContainerStyle={proxyStyles.content}
      >
        <View style={[proxyStyles.card, { backgroundColor: cardColor }]}>
          {!proxyState.profiles.length ? <EmptyText text="还没有代理配置" /> : null}
          {proxyState.profiles.map((profile) => {
            const active = profile.id === shownState.activeId;
            const selected = selectedIds.includes(profile.id);
            const activeApplying = applying && profile.id === proxyState.activeId;
            const activeDisplayedEnabled = active && shownState.enabled;
            let status = `${protocolLabel(profile.protocol)}${profile.username ? ' · 已填写账号' : ''}`;
            if (activeDisplayedEnabled) status = applyStatus === 'failed' ? '代理异常' : '已应用';
            if (activeApplying) status = '正在应用代理';
            const activeFailed = activeDisplayedEnabled && applyStatus === 'failed' && !activeApplying;
            const statusText =
              activeDisplayedEnabled && !selecting && !applying && !activeFailed ? `✓ ${status}` : status;
            return (
              <Pressable
                key={profile.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active || selected }}
                style={[proxyStyles.proxyRow, active && !selecting && { backgroundColor: accentSoftColor }]}
                onLongPress={() => setSelectedIds([profile.id])}
                onPress={() => chooseProfile(profile)}
              >
                {selecting ? (
                  <View
                    style={[
                      proxyStyles.checkCircle,
                      { borderColor: theme.lineStrong },
                      selected && { backgroundColor: accentColor, borderColor: accentColor }
                    ]}
                  >
                    {selected ? <Check size={13} color={theme.onPrimary} strokeWidth={2.4} /> : null}
                  </View>
                ) : null}
                <View style={styles.flex}>
                  <View style={proxyStyles.addressLine}>
                    <Text style={[styles.menuLabel, proxyStyles.proxyAddress, { color: theme.ink }]} numberOfLines={1}>
                      {profile.name}
                    </Text>
                    {active ? (
                      <View
                        style={[
                          proxyStyles.currentBadge,
                          {
                            backgroundColor: active && !selecting ? cardColor : accentSoftColor,
                            borderColor: accentBorderColor
                          }
                        ]}
                      >
                        <Text style={[styles.proxyCurrentLabel, { color: accentColor }]}>当前</Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={[proxyStyles.addressLine, proxyStyles.proxyDetails]}>
                    <Text style={[styles.meta, proxyStyles.proxyHost]} numberOfLines={1}>
                      {profile.host}:{profile.port}
                    </Text>
                    <Text
                      style={[
                        styles.meta,
                        proxyStyles.proxyStatus,
                        activeFailed
                          ? { color: theme.danger }
                          : activeApplying || activeDisplayedEnabled
                            ? { color: accentColor }
                            : null
                      ]}
                    >
                      {statusText}
                    </Text>
                  </View>
                </View>
                {!selecting ? (
                  <View style={proxyStyles.rowActions}>
                    <IconButton
                      ghost
                      iconOnly
                      iconSize={18}
                      icon={Pencil}
                      label="编辑代理"
                      disabled={busy}
                      onPress={() => openEdit(profile)}
                    />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            style={[
              proxyStyles.addRow,
              proxyState.profiles.length ? { borderTopColor: theme.line, marginTop: 6 } : { borderTopWidth: 0 }
            ]}
            onPress={openCreate}
          >
            <Plus size={18} color={accentColor} strokeWidth={2} />
            <Text style={[styles.proxyAddLabel, { color: accentColor }]}>添加代理</Text>
          </Pressable>
        </View>
      </ScrollView>
      <ModalSheetFrame
        backdropLabel="关闭代理表单"
        bottomInset={draftKeyboardInset}
        keyboardAvoiding={false}
        visible={active && draftMode !== null}
        onRequestClose={closeDraft}
      >
        <ModalSheetHeader
          title={draftMode === 'edit' ? '编辑代理' : '新增代理'}
          closeLabel="关闭代理编辑"
          closeDisabled={busy}
          onClose={closeDraft}
        />
        <ScrollView
          overScrollMode="never"
          style={[styles.searchFilterBody, { maxHeight: Math.max(320, Math.round(height * 0.58)) }]}
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
            onChange={(value) => updateDraft({ protocol: value as NetworkProxyProtocol })}
          />
          <ProxyInput
            label="名称"
            value={draft.name}
            error={visibleErrors.name}
            styles={styles}
            theme={theme}
            onChangeText={(name) => updateDraft({ name })}
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
              onChangeText={(host) => updateDraft({ host })}
            />
            <ProxyInput
              label="端口"
              value={draft.port}
              error={visibleErrors.port}
              styles={styles}
              theme={theme}
              keyboardType="number-pad"
              style={proxyStyles.portField}
              onChangeText={(port) => updateDraft({ port })}
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
              onChangeText={(username) => updateDraft({ username })}
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
              onChangeText={(password) => updateDraft({ password })}
            />
          </View>
        </ScrollView>
        <View style={styles.searchFilterActions}>
          {draftMode === 'edit' ? (
            <AppButton compact label="删除" variant="danger" disabled={busy} onPress={deleteDraftProfile} />
          ) : null}
          <View style={styles.flex} />
          <AppButton compact label="取消" variant="ghost" disabled={busy} onPress={closeDraft} />
          <AppButton
            compact
            minWidth={72}
            label={busy ? '保存中' : '确定'}
            loading={busy}
            variant="solid"
            disabled={busy}
            onPress={saveDraft}
          />
        </View>
      </ModalSheetFrame>
    </View>
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
        onChange={recordUserInteraction}
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
  errorBanner: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 4
  },
  header: {
    borderBottomWidth: 0,
    minHeight: 62
  },
  headerIcon: {
    alignItems: 'center',
    height: 48,
    justifyContent: 'center',
    width: 48
  },
  headerTitle: {
    flex: 1,
    marginHorizontal: 8
  },
  card: {
    borderRadius: readerRadii.surface,
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  proxyRow: {
    alignItems: 'center',
    borderRadius: readerRadii.control,
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: -10,
    minHeight: 58,
    paddingLeft: 10,
    paddingRight: 2,
    paddingVertical: 6
  },
  checkCircle: {
    alignItems: 'center',
    borderRadius: readerRadii.pill,
    borderWidth: 1.5,
    height: 28,
    justifyContent: 'center',
    width: 28
  },
  proxyAddress: {
    flexShrink: 1,
    fontWeight: '600'
  },
  proxyDetails: { flexWrap: 'wrap', rowGap: 0 },
  proxyHost: { maxWidth: '100%' },
  proxyStatus: { flexShrink: 1 },
  addressLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minWidth: 0
  },
  currentBadge: {
    borderRadius: readerRadii.badge,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 6,
    paddingVertical: 2
  },
  rowActions: {
    alignItems: 'center',
    flexDirection: 'row'
  },
  addRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 0,
    paddingVertical: 11
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
