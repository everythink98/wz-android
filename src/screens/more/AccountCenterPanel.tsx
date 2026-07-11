import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChevronRight, RefreshCw, User } from 'lucide-react-native';
import { CredentialVaultError } from '../../credentialVault';
import type { SessionSite, SiteSessionViewModels } from '../../siteSessionState';
import type { UserProfile } from '../../types';
import { androidRipple, createStyles, LINK_COLOR, type ReaderTheme } from '../../theme';
import { AppButton, ExpandablePanel, IconButton, triggerPressFeedback } from '../../components/AppControls';
import {
  accountCenterSummary,
  createSiteAccountViews,
  type CredentialSummaries,
  type SiteAccountView
} from './accountCenter';

export type AccountCenterCommand =
  | { type: 'refresh' }
  | { type: 'open-user'; user: UserProfile }
  | { type: 'open-login'; site: SessionSite }
  | { type: 'open-login-with-fill'; site: SessionSite }
  | { type: 'save-credential'; site: SessionSite; account: string; password: string; allowUnprotected?: boolean }
  | { type: 'delete-credential'; site: SessionSite };

type CommandHandler = (command: AccountCenterCommand) => void | Promise<void>;
type AccountCenterStyles = ReturnType<typeof createAccountCenterStyles>;

function createAccountCenterStyles(theme: ReaderTheme) {
  const actionColor = theme.dark ? theme.primary : LINK_COLOR;
  return StyleSheet.create({
    selectorRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 4
    },
    siteTabs: {
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flex: 1,
      flexDirection: 'row',
      gap: 0
    },
    siteTab: {
      alignItems: 'center',
      borderBottomColor: 'transparent',
      borderBottomWidth: 2,
      flex: 1,
      justifyContent: 'center',
      minHeight: 42,
      paddingHorizontal: 6,
      paddingVertical: 10
    },
    siteTabSelected: {
      borderBottomColor: actionColor
    },
    siteTabPressed: {
      opacity: 0.68
    },
    siteTabText: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: '600'
    },
    siteTabTextSelected: {
      color: theme.ink,
      fontWeight: '700'
    },
    siteDetail: {
      gap: 0,
      paddingBottom: 2,
      paddingHorizontal: 4,
      paddingTop: 4
    },
    accountPanel: {
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: 'hidden'
    },
    siteOverview: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 12
    },
    siteOverviewCopy: {
      flex: 1,
      gap: 2,
      minWidth: 0
    },
    siteTitle: {
      fontSize: 18
    },
    section: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      gap: 8,
      paddingBottom: 12,
      paddingHorizontal: 14,
      paddingTop: 12
    },
    sectionHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8
    },
    sectionCopy: {
      flex: 1,
      gap: 2,
      minWidth: 0
    },
    secondaryActions: {
      alignItems: 'center',
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 4,
      paddingHorizontal: 4,
      paddingVertical: 2
    },
    accountFeatures: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      gap: 2,
      paddingHorizontal: 14,
      paddingVertical: 6
    },
    action: {
      alignItems: 'center',
      borderRadius: 12,
      flexDirection: 'row',
      gap: 4,
      justifyContent: 'center',
      minHeight: 42,
      paddingHorizontal: 14,
      paddingVertical: 9
    },
    actionCompact: {
      minHeight: 38,
      paddingHorizontal: 10,
      paddingVertical: 7
    },
    actionPressed: {
      opacity: 0.72
    },
    actionDisabled: {
      opacity: 0.42
    },
    actionTextQuiet: {
      color: actionColor
    }
  });
}

function AccountAction({
  compact = false,
  disclosure = false,
  disabled = false,
  label,
  accountStyles,
  styles,
  theme,
  onPress
}: {
  compact?: boolean;
  disclosure?: boolean;
  disabled?: boolean;
  label: string;
  accountStyles: AccountCenterStyles;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      android_ripple={androidRipple(theme.primarySoft)}
      disabled={disabled}
      style={({ pressed }) => [
        accountStyles.action,
        compact && accountStyles.actionCompact,
        pressed && accountStyles.actionPressed,
        disabled && accountStyles.actionDisabled
      ]}
      onPress={() => {
        triggerPressFeedback();
        onPress();
      }}
    >
      <Text style={[styles.buttonText, accountStyles.actionTextQuiet]}>
        {label}
      </Text>
      {disclosure ? <ChevronRight size={15} color={theme.dark ? theme.primary : LINK_COLOR} strokeWidth={1.8} /> : null}
    </Pressable>
  );
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请重试。';
}

function CredentialEditor({
  active,
  view,
  accountStyles,
  styles,
  theme,
  onCommand
}: {
  active: boolean;
  view: SiteAccountView;
  accountStyles: AccountCenterStyles;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onCommand: CommandHandler;
}) {
  const [editing, setEditing] = useState(false);
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [keyboardAvoidingEnabled, setKeyboardAvoidingEnabled] = useState(false);
  const savingRef = useRef(false);

  const clearDraft = () => {
    setAccount('');
    setPassword('');
  };

  useEffect(() => {
    if (!active) {
      setKeyboardAvoidingEnabled(false);
      clearDraft();
      setEditing(false);
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
    if (busy || savingRef.current) {
      return;
    }
    setKeyboardAvoidingEnabled(false);
    Keyboard.dismiss();
    clearDraft();
    setEditing(false);
  };

  const persist = async (allowUnprotected = false) => {
    if (savingRef.current) {
      return;
    }
    savingRef.current = true;
    setKeyboardAvoidingEnabled(false);
    Keyboard.dismiss();
    setBusy(true);
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await onCommand({
        type: 'save-credential',
        site: view.site,
        account,
        password,
        ...(allowUnprotected ? { allowUnprotected: true } : {})
      });
      clearDraft();
      setEditing(false);
    } catch (error) {
      if (error instanceof CredentialVaultError && error.code === 'biometric-unavailable' && !allowUnprotected) {
        Alert.alert(
          '无法使用身份安全识别',
          '继续后将使用 Android 本机加密保存，但填入时不会再次进行身份安全识别。',
          [
            { text: '取消', style: 'cancel' },
            { text: '继续保存', onPress: () => { void persist(true); } }
          ]
        );
      } else {
        Alert.alert('无法保存登录信息', messageFromError(error));
      }
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      '删除已保存登录信息？',
      '只删除保存的账号密码，不会退出当前网站登录。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            void Promise.resolve(onCommand({ type: 'delete-credential', site: view.site }))
              .then(() => {
                clearDraft();
                setEditing(false);
              })
              .catch((error) => Alert.alert('无法删除登录信息', messageFromError(error)))
              .finally(() => setBusy(false));
          }
        }
      ]
    );
  };

  return (
    <View style={accountStyles.section}>
      <View style={accountStyles.sectionHeader}>
        <View style={accountStyles.sectionCopy}>
          <Text style={styles.menuLabel}>自动填入</Text>
          <Text style={styles.meta}>
            {view.credential.state === 'invalidated'
              ? '需要重新设置'
              : view.credential.hasCredential
              ? `已设置 · ${view.credential.protection === 'biometric' ? '身份识别保护' : 'Android 本机加密'}`
              : '未设置，登录失效时可快速填入'}
          </Text>
        </View>
        {!editing ? (
          <AccountAction
            compact
            disclosure
            label={view.credential.state === 'invalidated' ? '重新设置' : view.credential.hasCredential ? '管理' : '设置'}
            accountStyles={accountStyles}
            styles={styles}
            theme={theme}
            onPress={() => setEditing(true)}
          />
        ) : null}
      </View>
      <Modal transparent visible={editing} animationType="fade" onRequestClose={closeEditor}>
        <KeyboardAvoidingView behavior="height" enabled={keyboardAvoidingEnabled} style={styles.searchFilterModalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`关闭${view.label}自动填入设置`}
            disabled={busy}
            style={styles.searchFilterBackdrop}
            onPress={closeEditor}
          />
          <View style={styles.searchFilterSheet}>
            <View style={styles.searchFilterHandle} />
            <View style={styles.searchFilterHeader}>
              <View style={styles.flex}>
                <Text style={styles.searchFilterTitle}>
                  {view.credential.state === 'missing'
                    ? '设置自动填入'
                    : view.credential.state === 'invalidated'
                      ? '重新设置自动填入'
                      : '管理自动填入'}
                </Text>
                <Text style={styles.meta}>{view.label}</Text>
              </View>
            </View>
            <ScrollView
              style={styles.searchFilterBody}
              contentContainerStyle={styles.searchFilterBodyInner}
              keyboardShouldPersistTaps="always"
            >
              <View style={styles.stack}>
                <Text style={styles.panelTitle}>账号 / 邮箱</Text>
                <TextInput
                  accessibilityLabel={`${view.label} 登录账号`}
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect={false}
                  placeholder="账号 / 邮箱"
                  placeholderTextColor={theme.muted}
                  style={styles.input}
                  value={account}
                  onFocus={() => setKeyboardAvoidingEnabled(true)}
                  onChangeText={setAccount}
                />
              </View>
              <View style={styles.stack}>
                <Text style={styles.panelTitle}>密码</Text>
                <TextInput
                  accessibilityLabel={`${view.label} 登录密码`}
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect={false}
                  placeholder="密码"
                  placeholderTextColor={theme.muted}
                  secureTextEntry
                  style={styles.input}
                  value={password}
                  onFocus={() => setKeyboardAvoidingEnabled(true)}
                  onChangeText={setPassword}
                />
              </View>
            </ScrollView>
            <View style={styles.searchFilterActions}>
              {view.credential.state !== 'missing' ? (
                <AppButton compact label="删除" variant="danger" styles={styles} disabled={busy} onPress={confirmDelete} />
              ) : null}
              <View style={styles.flex} />
              <AppButton compact label="取消" variant="ghost" styles={styles} disabled={busy} onPress={closeEditor} />
              <AppButton
                compact
                label={busy ? '保存中' : '保存'}
                variant="primary"
                styles={styles}
                disabled={busy || !account.trim() || !password}
                onPress={() => { void persist(); }}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  expanded,
  forcedSite,
  pendingFillSite,
  nodeSeekUserId,
  sessions,
  siteContent,
  statusBusy,
  styles,
  theme,
  onCommand,
  onExpandedChange
}: {
  credentials: CredentialSummaries;
  expanded: boolean;
  forcedSite?: SessionSite | null;
  pendingFillSite?: SessionSite | null;
  nodeSeekUserId: number | null;
  sessions: SiteSessionViewModels;
  siteContent: Partial<Record<SessionSite, ReactNode>>;
  statusBusy: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onCommand: CommandHandler;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const [expandedSite, setExpandedSite] = useState<SessionSite>('nodeseek');
  const views = useMemo(() => createSiteAccountViews(sessions, credentials, nodeSeekUserId), [credentials, nodeSeekUserId, sessions]);
  const accountStyles = useMemo(() => createAccountCenterStyles(theme), [theme]);
  const selectedView = views.find((view) => view.site === expandedSite) ?? views[0]!;
  const primary = primaryCommand(selectedView);
  const waitingForForm = pendingFillSite === selectedView.site;
  const loggedIn = selectedView.isLoggedIn;

  useEffect(() => {
    if (forcedSite) {
      setExpandedSite(forcedSite);
    }
  }, [forcedSite]);

  return (
    <ExpandablePanel
      quiet
      title="账号中心"
      meta={accountCenterSummary(views)}
      icon={User}
      expanded={expanded}
      styles={styles}
      theme={theme}
      onExpandedChange={onExpandedChange}
    >
      <View style={accountStyles.selectorRow}>
        <Text style={styles.meta}>站点</Text>
        <IconButton
          compact
          ghost
          icon={RefreshCw}
          label={statusBusy ? '刷新中' : '刷新账号状态'}
          styles={styles}
          theme={theme}
          disabled={statusBusy}
          onPress={() => { void onCommand({ type: 'refresh' }); }}
        />
      </View>
      <View style={accountStyles.siteTabs}>
          {views.map((view) => {
            const selected = selectedView.site === view.site;
            return (
              <Pressable
                key={view.site}
                accessibilityRole="tab"
                accessibilityLabel={`${view.label}，${view.statusLabel}`}
                accessibilityState={{ selected }}
                android_ripple={androidRipple(theme.primarySoft)}
                style={({ pressed }) => [
                  accountStyles.siteTab,
                  selected && accountStyles.siteTabSelected,
                  pressed && accountStyles.siteTabPressed
                ]}
                onPress={() => {
                  triggerPressFeedback();
                  setExpandedSite(view.site);
                }}
              >
                <Text numberOfLines={1} style={[accountStyles.siteTabText, selected && accountStyles.siteTabTextSelected]}>
                  {view.label}
                </Text>
              </Pressable>
            );
          })}
      </View>
      <View style={accountStyles.siteDetail}>
        <View style={accountStyles.accountPanel}>
          <View style={accountStyles.siteOverview}>
            <View style={accountStyles.siteOverviewCopy}>
              <Text style={[styles.menuLabel, accountStyles.siteTitle]}>{selectedView.label}</Text>
              <Text style={styles.meta}>
                {selectedView.identityLabel === selectedView.statusLabel
                  ? selectedView.statusLabel
                  : `${selectedView.identityLabel} · ${selectedView.statusLabel}`}
              </Text>
            </View>
            {primary ? (
              <AccountAction
                compact
                disclosure
                label={waitingForForm ? '等待登录表单' : selectedView.primaryAction === 'open-user' ? '查看主页' : selectedView.primaryLabel}
                accountStyles={accountStyles}
                styles={styles}
                theme={theme}
                disabled={selectedView.primaryDisabled || waitingForForm}
                onPress={() => { void onCommand(primary); }}
              />
            ) : null}
          </View>
          <CredentialEditor
            key={selectedView.site}
            active={expanded && forcedSite !== selectedView.site}
            view={selectedView}
            accountStyles={accountStyles}
            styles={styles}
            theme={theme}
            onCommand={onCommand}
          />
          {loggedIn ? (
            <View style={accountStyles.secondaryActions}>
              <AccountAction
                compact
                disclosure
                label="检测或重新登录"
                accountStyles={accountStyles}
                styles={styles}
                theme={theme}
                onPress={() => { void onCommand({ type: 'open-login', site: selectedView.site }); }}
              />
              {selectedView.credential.hasCredential ? (
                <AccountAction
                  compact
                  label="自动填入"
                  accountStyles={accountStyles}
                  styles={styles}
                  theme={theme}
                  disabled={waitingForForm}
                  onPress={() => { void onCommand({ type: 'open-login-with-fill', site: selectedView.site }); }}
                />
              ) : null}
            </View>
          ) : null}
          {siteContent[selectedView.site] ? (
            <View style={accountStyles.accountFeatures}>
              {siteContent[selectedView.site]}
            </View>
          ) : null}
        </View>
      </View>
    </ExpandablePanel>
  );
}
