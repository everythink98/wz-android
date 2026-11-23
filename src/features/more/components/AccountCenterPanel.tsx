import { recordUserInteraction } from '@/platform/network/userPresence';
import type { MoreScreenStyles } from '../styles';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import { Alert, Keyboard, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { ChevronRight, RefreshCw, Settings2 } from 'lucide-react-native';
import { List } from 'react-native-paper';
import { AppTextInput as TextInput } from '@/ui/controls/InputControls';
import { CredentialVaultError } from '@/platform/storage/credentialVault';
import type { CredentialSite } from '@/domain/session/sessionContracts';
import type { AccountCenterCommand } from '@/domain/session/accountCenter';
import type { UserDetails } from '@/domain/forum/models';
import { Avatar } from '@/ui/avatar/Avatar';
import type { SessionSite, SiteSessionViewModels } from '@/domain/session/siteSessionState';
import {
  createUiFontSizer,
  type ReaderStyleSettings,
  fontFamilyValue,
  type ReaderTheme,
  textSizeStyle
} from '@/ui/theme/tokens';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { DisclosureChevron, ExpandableContent } from '@/ui/controls/ExpandableControls';
import { ModalSheetFrame, ModalSheetHeader } from '@/ui/controls/ModalSheetFrame';
import { Portal } from '@gorhom/portal';
import { createMoreSiteSettingStyles } from '../accountStyles';
import {
  accountCenterSummary,
  createSiteAccountViews,
  type CredentialSummaries,
  type SiteAccountView
} from '../accountCenter';

type CommandHandler = (command: AccountCenterCommand) => void | Promise<void>;
type AccountCenterStyles = ReturnType<typeof createAccountCenterStyles>;

function createAccountCenterStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const actionColor = theme.primary;
  const fontSize = createUiFontSizer(settings);
  return StyleSheet.create({
    header: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 52 },
    title: {
      flex: 1,
      color: theme.ink,
      fontFamily: fontFamilyValue(settings.uiFontFamily),
      ...textSizeStyle(fontSize(22)),
      fontWeight: '600'
    },
    selectorRow: {
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      marginBottom: 0
    },
    siteTabs: {
      flex: 1,
      flexDirection: 'row',
      minWidth: 0
    },
    settingsButton: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
      gap: 6,
      justifyContent: 'center',
      minHeight: 48,
      paddingHorizontal: 8
    },
    settingsRow: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row'
    },
    settingsBody: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      gap: 8,
      paddingTop: 8,
      paddingBottom: 8
    },
    siteTab: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      minHeight: 48,
      paddingHorizontal: 6,
      paddingVertical: 10
    },
    siteTabIndicator: {
      backgroundColor: actionColor,
      bottom: 0,
      height: 2,
      position: 'absolute',
      width: 24
    },
    siteTabText: {
      color: theme.muted,
      fontFamily: fontFamilyValue(settings.uiFontFamily),
      ...textSizeStyle(fontSize(13)),
      fontWeight: '500'
    },
    siteTabTextSelected: {
      color: theme.primary,
      fontWeight: '600'
    },
    siteDetail: {
      gap: 0,
      paddingHorizontal: 0,
      paddingTop: 0
    },
    accountPanel: {
      backgroundColor: 'transparent'
    },
    siteOverview: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 14,
      paddingHorizontal: 0,
      paddingTop: 16,
      paddingBottom: 16
    },
    siteOverviewCopy: {
      flex: 1,
      gap: 4,
      minWidth: 0
    },
    identityName: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 6,
      maxWidth: '100%'
    },
    siteTitle: {
      flexShrink: 1,
      fontSize: fontSize(20),
      fontWeight: '600',
      textAlign: 'left'
    },
    identityMeta: {
      fontSize: fontSize(12),
      lineHeight: fontSize(17),
      textAlign: 'left'
    },
    section: {
      gap: 4,
      paddingBottom: 0,
      paddingHorizontal: 0,
      paddingTop: 0
    },
    secondaryActions: {
      alignItems: 'center',
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      paddingHorizontal: 0,
      paddingVertical: 6
    },
    accountFeatures: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      gap: 2,
      paddingHorizontal: 0,
      paddingVertical: 2
    },
    actionTextQuiet: {
      color: actionColor
    }
  });
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请重试。';
}

type CredentialEditorOpening = { owner: AbortSignal };
type CredentialEditorOperation = { opening: CredentialEditorOpening };
type CredentialEditorState =
  | { phase: 'closed' }
  | { phase: 'editing'; opening: CredentialEditorOpening }
  | { phase: 'working'; operation: CredentialEditorOperation };

function CredentialEditor({
  active,
  site,
  view,
  accountStyles,
  styles,
  onCommand
}: {
  active: boolean;
  site: CredentialSite;
  view: SiteAccountView;
  accountStyles: AccountCenterStyles;
  styles: MoreScreenStyles;
  onCommand: CommandHandler;
}) {
  const { height } = useWindowDimensions();
  const { styles: settingStyles } = useReaderThemeStyles(createMoreSiteSettingStyles);
  const [editorState, setEditorState] = useState<CredentialEditorState>({ phase: 'closed' });
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [keyboardAvoidingEnabled, setKeyboardAvoidingEnabled] = useState(false);
  const lifetimeRef = useRef(new AbortController());
  const editorRef = useRef(editorState);
  const callbacks = useCommittedRef({ active, onCommand });
  const editing = editorState.phase !== 'closed';
  const busy = editorState.phase === 'working';
  const currentOpening = () => {
    const state = editorRef.current;
    return state.phase === 'closed' ? null : state.phase === 'editing' ? state.opening : state.operation.opening;
  };
  const transitionEditor = (state: CredentialEditorState) => {
    editorRef.current = state;
    if (!lifetimeRef.current.signal.aborted) setEditorState(state);
  };
  const isCurrentOpening = (opening: CredentialEditorOpening) =>
    currentOpening() === opening &&
    callbacks.current.active &&
    !opening.owner.aborted &&
    lifetimeRef.current.signal === opening.owner;
  const isCurrentOperation = (operation: CredentialEditorOperation) =>
    editorRef.current.phase === 'working' &&
    editorRef.current.operation === operation &&
    isCurrentOpening(operation.opening);

  useLayoutEffect(() => {
    if (lifetimeRef.current.signal.aborted) lifetimeRef.current = new AbortController();
    const lifetime = lifetimeRef.current;
    const opening = currentOpening();
    if (opening) opening.owner = lifetime.signal;
    return () => lifetime.abort();
  }, []);

  const openEditor = () => {
    if (!callbacks.current.active || lifetimeRef.current.signal.aborted) return;
    recordUserInteraction();
    transitionEditor({ phase: 'editing', opening: { owner: lifetimeRef.current.signal } });
  };

  const clearDraft = () => {
    setAccount('');
    setPassword('');
  };

  useEffect(() => {
    if (!active) {
      transitionEditor({ phase: 'closed' });
      setKeyboardAvoidingEnabled(false);
      clearDraft();
    }
  }, [active]);

  useEffect(() => {
    if (!editing) {
      return;
    }
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => setKeyboardAvoidingEnabled(true));
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setKeyboardAvoidingEnabled(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [editing]);

  const closeEditor = () => {
    if (editorRef.current.phase === 'working') {
      return;
    }
    setKeyboardAvoidingEnabled(false);
    Keyboard.dismiss();
    clearDraft();
    transitionEditor({ phase: 'closed' });
  };

  const beginOperation = (opening: CredentialEditorOpening) => {
    if (editorRef.current.phase !== 'editing' || !isCurrentOpening(opening)) return null;
    const operation = { opening };
    transitionEditor({ phase: 'working', operation });
    return operation;
  };
  const finishOperation = (operation: CredentialEditorOperation) => {
    if (editorRef.current.phase !== 'working' || editorRef.current.operation !== operation) return;
    transitionEditor({ phase: 'editing', opening: operation.opening });
  };
  const finishEditor = () => {
    clearDraft();
    transitionEditor({ phase: 'closed' });
  };

  const persist = async (allowUnprotected = false, opening = currentOpening()) => {
    if (!opening) return;
    const operation = beginOperation(opening);
    if (!operation) {
      return;
    }
    setKeyboardAvoidingEnabled(false);
    Keyboard.dismiss();
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!isCurrentOperation(operation)) return;
      await callbacks.current.onCommand({
        type: 'save-credential',
        site,
        account,
        password,
        ...(allowUnprotected ? { allowUnprotected: true } : {})
      });
      if (isCurrentOperation(operation)) finishEditor();
    } catch (error) {
      if (!isCurrentOperation(operation)) return;
      if (error instanceof CredentialVaultError && error.code === 'biometric-unavailable' && !allowUnprotected) {
        Alert.alert('无法使用用户身份认证', '继续后将使用 Android 本机加密保存，但填入时不会再次进行用户身份认证。', [
          { text: '取消', style: 'cancel' },
          {
            text: '继续保存',
            onPress: () => {
              void persist(true, opening);
            }
          }
        ]);
      } else {
        Alert.alert('无法保存登录信息', messageFromError(error));
      }
    } finally {
      finishOperation(operation);
    }
  };

  const confirmDelete = () => {
    const opening = currentOpening();
    if (!opening || !isCurrentOpening(opening)) return;
    Alert.alert('删除已保存登录信息？', '只删除保存的账号密码，不会退出当前网站登录。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          const operation = beginOperation(opening);
          if (!operation) return;
          void (async () => {
            try {
              await callbacks.current.onCommand({ type: 'delete-credential', site });
              if (isCurrentOperation(operation)) finishEditor();
            } catch (error) {
              if (isCurrentOperation(operation)) Alert.alert('无法删除登录信息', messageFromError(error));
            } finally {
              finishOperation(operation);
            }
          })();
        }
      }
    ]);
  };

  return (
    <View style={accountStyles.section}>
      <List.Item
        testID="account-credential-row"
        title="自动填入"
        accessible={false}
        onPress={openEditor}
        description={
          view.credential.state === 'invalidated'
            ? '需要重新设置'
            : view.credential.hasCredential
              ? `已设置 · ${view.credential.protection === 'biometric' ? '用户身份认证' : 'Android 本机加密'}`
              : undefined
        }
        style={settingStyles.row}
        containerStyle={settingStyles.rowContainer}
        contentStyle={settingStyles.rowContent}
        titleStyle={settingStyles.title}
        descriptionStyle={settingStyles.description}
        descriptionNumberOfLines={2}
        right={
          !editing
            ? () => (
                <AppButton
                  compact
                  label={
                    view.credential.state === 'invalidated'
                      ? '重新设置'
                      : view.credential.hasCredential
                        ? '管理'
                        : '设置'
                  }
                  onPress={openEditor}
                />
              )
            : undefined
        }
      />
      <ModalSheetFrame
        backdropLabel={`关闭${view.label}自动填入设置`}
        keyboardAvoidingEnabled={keyboardAvoidingEnabled}
        visible={editing}
        onRequestClose={closeEditor}
      >
        <ModalSheetHeader
          title={
            view.credential.state === 'missing'
              ? '设置自动填入'
              : view.credential.state === 'invalidated'
                ? '重新设置自动填入'
                : '管理自动填入'
          }
          subtitle={view.label}
          closeLabel="关闭自动填入编辑"
          closeDisabled={busy}
          onClose={closeEditor}
        />
        <ScrollView
          overScrollMode="never"
          style={[styles.searchFilterBody, { maxHeight: Math.max(320, Math.round(height * 0.58)) }]}
          contentContainerStyle={styles.searchFilterBodyInner}
          keyboardShouldPersistTaps="always"
        >
          <TextInput
            variant="outlined"
            label="账号 / 邮箱"
            accessibilityLabel={`${view.label} 登录账号`}
            aria-label={`${view.label} 登录账号`}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            style={settingStyles.input}
            value={account}
            onFocus={() => setKeyboardAvoidingEnabled(true)}
            onChange={recordUserInteraction}
            onChangeText={setAccount}
          />
          <TextInput
            variant="outlined"
            label="密码"
            accessibilityLabel={`${view.label} 登录密码`}
            aria-label={`${view.label} 登录密码`}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            secureTextEntry
            style={settingStyles.input}
            value={password}
            onFocus={() => setKeyboardAvoidingEnabled(true)}
            onChange={recordUserInteraction}
            onChangeText={setPassword}
          />
        </ScrollView>
        <View style={styles.searchFilterActions}>
          {view.credential.state !== 'missing' ? (
            <AppButton
              compact
              variant="danger"
              accessibilityLabel="删除"
              label="删除"
              disabled={busy}
              onPress={confirmDelete}
            />
          ) : null}
          <View style={styles.flex} />
          <AppButton
            compact
            variant="ghost"
            accessibilityLabel="取消"
            label="取消"
            disabled={busy}
            onPress={closeEditor}
          />
          <AppButton
            compact
            variant="solid"
            accessibilityLabel={busy ? '保存中' : '保存'}
            label={busy ? '保存中' : '保存'}
            loading={busy}
            disabled={busy || !account.trim() || !password}
            onPress={() => void persist()}
          />
        </View>
      </ModalSheetFrame>
    </View>
  );
}

function primaryCommand(view: SiteAccountView): AccountCenterCommand | null {
  if (view.primaryAction === 'open-user' && view.user) {
    return { type: 'open-user', user: view.user };
  }
  if (view.primaryAction === 'open-login') {
    return { type: 'open-login', site: view.site };
  }
  if (view.primaryAction === 'open-login-with-fill') {
    return { type: 'open-login-with-fill', site: view.site };
  }
  return null;
}

export function AccountCenterPanel({
  credentials,
  enabledSessionSources,
  active,
  forcedSite,
  headerHostName,
  pendingFillSite,
  selectedSite,
  profile,
  renderOverview,
  nodeSeekUserId,
  sessions,
  siteContent,
  siteSettings,
  statusBusy,
  styles,
  theme,
  onCommand,
  onSelectedSiteChange
}: {
  credentials: CredentialSummaries;
  enabledSessionSources: readonly SessionSite[];
  active: boolean;
  forcedSite?: SessionSite | null;
  headerHostName?: string;
  pendingFillSite?: SessionSite | null;
  selectedSite?: SessionSite;
  profile?: UserDetails;
  renderOverview?: (settingsAction: ReactNode) => ReactNode;
  nodeSeekUserId: number | null;
  sessions: SiteSessionViewModels;
  siteContent: Partial<Record<SessionSite, ReactNode>>;
  siteSettings?: Partial<Record<SessionSite, (active: boolean) => ReactNode>>;
  statusBusy: boolean;
  styles: MoreScreenStyles;
  theme: ReaderTheme;
  onCommand: CommandHandler;
  onSelectedSiteChange?: (site: SessionSite) => void;
}) {
  const [expandedSite, setExpandedSite] = useState<SessionSite>('nodeseek');
  const [settingsState, setSettingsState] = useState<
    { phase: 'unvisited' } | { owner: string; phase: 'expanded' | 'collapsed' }
  >({ phase: 'unvisited' });
  const availableViews = useMemo(
    () => createSiteAccountViews(sessions, credentials, nodeSeekUserId),
    [credentials, nodeSeekUserId, sessions]
  );
  const views = useMemo(() => {
    const viewsBySite = new Map(availableViews.map((view) => [view.site, view]));
    return enabledSessionSources
      .map((site) => viewsBySite.get(site))
      .filter((view): view is SiteAccountView => Boolean(view));
  }, [availableViews, enabledSessionSources]);
  const { styles: accountStyles } = useReaderThemeStyles(createAccountCenterStyles);
  const selectedView = views.find((view) => view.site === (selectedSite ?? expandedSite)) ?? views[0];
  const settingsOwner = selectedView ? `${selectedView.site}:${selectedView.user?.id ?? 'anonymous'}` : '';
  const settingsVisited = settingsState.phase !== 'unvisited' && settingsState.owner === settingsOwner;
  const settingsExpanded = settingsVisited && settingsState.phase === 'expanded';
  if (settingsState.phase !== 'unvisited' && settingsState.owner !== settingsOwner)
    setSettingsState({ phase: 'unvisited' });
  const headerContent = (
    <View style={[accountStyles.header, styles.morePageInset]}>
      <Text style={accountStyles.title}>我的</Text>
      {views.length ? <Text style={styles.meta}>{accountCenterSummary(views)}</Text> : null}
      {views.length ? (
        <IconButton
          ghost
          iconOnly
          iconSize={18}
          icon={RefreshCw}
          label={statusBusy ? '刷新中' : '刷新账号'}
          disabled={!active && statusBusy}
          loading={active && statusBusy}
          onPress={() => void onCommand({ type: 'refresh' })}
        />
      ) : null}
    </View>
  );

  const header = headerHostName ? <Portal hostName={headerHostName}>{headerContent}</Portal> : headerContent;

  useEffect(() => {
    if (selectedSite !== undefined) return;
    const requestedSite = forcedSite ?? pendingFillSite;
    const nextView = requestedSite ? (views.find((view) => view.site === requestedSite) ?? views[0]) : selectedView;
    if (nextView && nextView.site !== expandedSite) {
      setExpandedSite(nextView.site);
      onSelectedSiteChange?.(nextView.site);
    }
  }, [expandedSite, forcedSite, pendingFillSite, selectedSite, selectedView, views, onSelectedSiteChange]);

  if (!selectedView) {
    return (
      <View testID="my-account">
        {header}
        <View style={[accountStyles.siteDetail, styles.morePageInset]}>
          <View style={accountStyles.accountPanel}>
            <View style={accountStyles.siteOverview}>
              <View style={accountStyles.siteOverviewCopy}>
                <Text style={styles.menuLabel}>尚未启用账号站点</Text>
                <Text style={styles.meta}>请在“内容源”面板启用支持账号的站点。</Text>
              </View>
            </View>
          </View>
        </View>
      </View>
    );
  }

  const primary = primaryCommand(selectedView);
  const waitingForForm = pendingFillSite === selectedView.site;
  const loggedIn = selectedView.isLoggedIn;
  const levelLabel = profile?.levelLabel || selectedView.user?.levelLabel;
  const renderSettings = siteSettings?.[selectedView.site];
  const primaryLabel = waitingForForm
    ? '等待登录表单'
    : selectedView.primaryAction === 'open-user'
      ? '查看主页'
      : selectedView.primaryLabel;
  const settingsAction = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="站点设置"
      accessibilityHint={`${settingsExpanded ? '收起' : '展开'}${selectedView.label}的登录信息与设置`}
      accessibilityState={{ expanded: settingsExpanded }}
      style={accountStyles.settingsButton}
      onPress={() =>
        setSettingsState((current) => ({
          owner: settingsOwner,
          phase: current.phase === 'expanded' && current.owner === settingsOwner ? 'collapsed' : 'expanded'
        }))
      }
    >
      <Settings2 size={16} color={theme.muted} strokeWidth={1.8} />
      <Text style={styles.meta}>站点设置</Text>
      <DisclosureChevron expanded={settingsExpanded} color={theme.muted} size={14} />
    </Pressable>
  );

  return (
    <View testID="my-account">
      {header}
      <View style={accountStyles.selectorRow}>
        <View style={accountStyles.siteTabs}>
          {views.map((view) => {
            const selected = selectedView.site === view.site;
            return (
              <Pressable
                key={view.site}
                testID={`account-site-${view.site}`}
                accessibilityRole="tab"
                accessibilityLabel={`${view.label}，${view.statusLabel}${selected ? '，已选择' : ''}`}
                accessibilityState={{ selected }}
                style={accountStyles.siteTab}
                onPress={() => {
                  if (selected) return;
                  if (selectedSite === undefined) setExpandedSite(view.site);
                  onSelectedSiteChange?.(view.site);
                  setSettingsState({ phase: 'unvisited' });
                }}
              >
                <Text
                  numberOfLines={1}
                  style={[accountStyles.siteTabText, selected && accountStyles.siteTabTextSelected]}
                >
                  {view.label}
                </Text>
                {selected ? <View style={accountStyles.siteTabIndicator} /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>
      <Pressable
        accessibilityRole={primary ? 'button' : undefined}
        accessibilityLabel={primary ? primaryLabel : undefined}
        accessibilityHint={primary ? `${selectedView.identityLabel}，${selectedView.statusLabel}` : undefined}
        accessibilityState={{ disabled: !primary || selectedView.primaryDisabled || waitingForForm }}
        disabled={!primary || selectedView.primaryDisabled || waitingForForm}
        style={[accountStyles.siteOverview, styles.morePageInset]}
        onPress={() => {
          if (primary) void onCommand(primary);
        }}
      >
        <Avatar
          key={settingsOwner}
          large
          contentSource={selectedView.site}
          name={profile?.displayName || selectedView.identityLabel}
          uri={profile?.avatar || selectedView.user?.avatar}
        />
        <View style={accountStyles.siteOverviewCopy}>
          <View style={accountStyles.identityName}>
            <Text numberOfLines={2} style={[styles.menuLabel, accountStyles.siteTitle]}>
              {selectedView.user ? profile?.displayName || selectedView.identityLabel : selectedView.label}
            </Text>
            {primary ? <ChevronRight size={15} color={theme.muted} strokeWidth={1.8} /> : null}
          </View>
          <Text style={[styles.meta, accountStyles.identityMeta]}>
            {selectedView.statusLabel}
            {levelLabel ? ` · ${levelLabel}` : ''}
          </Text>
          {primary && selectedView.primaryAction !== 'open-user' ? (
            <Text style={[styles.buttonText, accountStyles.actionTextQuiet]}>{primaryLabel}</Text>
          ) : null}
        </View>
      </Pressable>
      {renderOverview ? (
        <View style={accountStyles.section}>{renderOverview(settingsAction)}</View>
      ) : (
        <View style={[accountStyles.settingsRow, styles.morePageInset]}>{settingsAction}</View>
      )}
      {settingsVisited ? (
        <ExpandableContent expanded={settingsExpanded}>
          <View testID="account-site-settings" style={[accountStyles.settingsBody, styles.morePageInset]}>
            <CredentialEditor
              key={settingsOwner}
              active={active && settingsExpanded && forcedSite !== selectedView.site}
              site={selectedView.site}
              view={selectedView}
              accountStyles={accountStyles}
              styles={styles}
              onCommand={onCommand}
            />
            {loggedIn ? (
              <View style={accountStyles.secondaryActions}>
                <AppButton
                  compact
                  accessibilityLabel="检测或重新登录"
                  label="检测或重新登录"
                  onPress={() => {
                    setSettingsState({ phase: 'unvisited' });
                    void onCommand({ type: 'open-login', site: selectedView.site });
                  }}
                />
                {selectedView.credential.hasCredential ? (
                  <AppButton
                    compact
                    accessibilityLabel="填入并登录"
                    label="填入并登录"
                    disabled={waitingForForm}
                    onPress={() => {
                      setSettingsState({ phase: 'unvisited' });
                      void onCommand({ type: 'open-login-with-fill', site: selectedView.site });
                    }}
                  />
                ) : null}
              </View>
            ) : null}
            {renderSettings ? (
              <View style={accountStyles.accountFeatures}>{renderSettings(active && settingsExpanded)}</View>
            ) : null}
          </View>
        </ExpandableContent>
      ) : null}
      <View style={[accountStyles.siteDetail, styles.morePageInset]}>
        <View style={accountStyles.accountPanel}>
          {siteContent[selectedView.site] ? (
            <View style={accountStyles.accountFeatures}>{siteContent[selectedView.site]}</View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
