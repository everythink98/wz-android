import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text, TextInput, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { CheckCircle, Image as ImageIcon } from 'lucide-react-native';
import {
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
  fontScaleFromSliderPosition,
  normalizeFontScale,
  type ReaderSettings
} from '../../readerData';
import type { LoginNavigationRequest } from '../../appTypes';
import { NODESEEK_URL, YAOHUO_URL } from '../../appUrls';
import type { SiteSessionViewModel } from '../../siteSessionState';
import { createStyles, type ReaderTheme } from '../../theme';
import { AppButton, MenuButton, triggerPressFeedback } from '../../components/AppControls';
import { LoginWebViewModal } from '../../components/LoginWebViewModal';
import {
  NODESEEK_LOGIN_PROBE_SCRIPT,
  NODESEEK_REPLAY_READINESS_SCRIPT,
  NODESEEK_REPLAY_READY_MESSAGE
} from '../../loginWebViewScripts';
import { LOGIN_FORM_ADAPTERS } from '../../loginFormAdapters';
import { shouldOpenLoginWebViewUrl } from '../../loginWebViewNavigation';
import { LinuxDoLevelPanel } from './LinuxDoLevelPanel';
import { useCommittedRef } from '../../app/useCommittedRef';

const YAOHUO_LOGIN_URL = YAOHUO_URL + '/waplogin.aspx?siteid=1000';
const YAOHUO_SESSION_URL = YAOHUO_URL + '/wapindex.aspx?sid=-2';
const LOGIN_WEBVIEW_LOADING_TIMEOUT_MS = 12000;

export function BackupRestorePanel({
  backupBusy,
  styles,
  onExportBackupFile,
  onImportBackupFile
}: {
  backupBusy: boolean;
  styles: ReturnType<typeof createStyles>;
  onExportBackupFile: () => void;
  onImportBackupFile: () => void;
}) {
  return (
    <View style={styles.stack}>
      <View style={styles.actions}>
        <AppButton label={backupBusy ? '处理中' : '导出备份文件'} styles={styles} disabled={backupBusy} onPress={onExportBackupFile} />
        <AppButton label="选择备份文件恢复" variant="ghost" styles={styles} disabled={backupBusy} onPress={onImportBackupFile} />
      </View>
    </View>
  );
}

export function NodeSeekLoginPanel({
  accountExpanded,
  checking,
  credentialAttempt,
  credentialFillPending,
  credentialSaved,
  nodeSeekSession,
  nodeImageApiKeyBusy,
  nodeImageApiKeySaved,
  loginFormMode,
  loadingLoginPage,
  nodeSeekWebViewUserAgent,
  showLoginPanel,
  styles,
  theme,
  webViewRef,
  webViewBlockMessage,
  onCheckIn,
  onCheckLogin,
  onAuthorizeNodeImageApiKey,
  onSaveNodeImageApiKey,
  onClearNodeImageApiKey,
  onClearLogin,
  onHandleLoginMessage,
  onLoginFormMessage,
  onRequestCredentialFill,
  onWebViewState,
  handleNodeSeekLoginNavigation,
  onSetLoadingLoginPage,
  onShowLoginPanelChange
}: {
  accountExpanded: boolean;
  checking: boolean;
  credentialAttempt: number;
  credentialFillPending: boolean;
  credentialSaved: boolean;
  nodeSeekSession: SiteSessionViewModel;
  nodeImageApiKeyBusy: boolean;
  nodeImageApiKeySaved: boolean;
  loginFormMode: boolean;
  loadingLoginPage: boolean;
  nodeSeekWebViewUserAgent: string;
  showLoginPanel: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  webViewRef: RefObject<WebView | null>;
  webViewBlockMessage: string;
  onCheckIn: () => void;
  onCheckLogin: () => void;
  onAuthorizeNodeImageApiKey: () => void;
  onSaveNodeImageApiKey: (value: string) => void;
  onClearNodeImageApiKey: () => void;
  onClearLogin: () => void;
  onHandleLoginMessage: (event: WebViewMessageEvent) => void;
  onLoginFormMessage: (event: WebViewMessageEvent) => boolean;
  onRequestCredentialFill: () => void;
  onWebViewState: (state: 'start' | 'ready' | 'error' | 'renderer-gone' | 'timeout', attempt?: number) => void;
  handleNodeSeekLoginNavigation: (request: LoginNavigationRequest) => boolean;
  onSetLoadingLoginPage: (value: boolean) => void;
  onShowLoginPanelChange: (value: boolean) => void;
}) {
  const [webViewError, setWebViewError] = useState('');
  const [webViewKey, setWebViewKey] = useState(0);
  const [webViewNeedsRemount, setWebViewNeedsRemount] = useState(false);
  const [webViewReadyForReplay, setWebViewReadyForReplay] = useState(false);
  const [showNodeImagePanel, setShowNodeImagePanel] = useState(false);
  const [showManualNodeImageKey, setShowManualNodeImageKey] = useState(false);
  const [nodeImageApiKeyDraft, setNodeImageApiKeyDraft] = useState('');

  useEffect(() => {
    if (!showLoginPanel) {
      setWebViewError('');
      setWebViewNeedsRemount(false);
      setWebViewReadyForReplay(false);
    }
  }, [showLoginPanel]);

  useEffect(() => {
    if (!showLoginPanel || !loadingLoginPage || webViewBlockMessage) {
      return undefined;
    }
    const timeout = setTimeout(() => {
      setWebViewReadyForReplay(false);
      onWebViewState('timeout', credentialAttempt);
      onSetLoadingLoginPage(false);
      setWebViewError('NodeSeek 页面打开超时：请检查模拟器网络后刷新页面。');
    }, LOGIN_WEBVIEW_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [credentialAttempt, loadingLoginPage, onSetLoadingLoginPage, onWebViewState, showLoginPanel, webViewBlockMessage, webViewRef]);

  const refreshWebView = () => {
    setWebViewError('');
    setWebViewReadyForReplay(false);
    onSetLoadingLoginPage(true);
    if (webViewNeedsRemount) {
      setWebViewNeedsRemount(false);
      setWebViewKey((current) => current + 1);
      return;
    }
    webViewRef.current?.reload();
  };

  return (
    <>
      {nodeSeekSession.canWrite ? <MenuButton nested icon={CheckCircle} label="NodeSeek 签到" value="使用本机登录 Cookie" styles={styles} theme={theme} onPress={onCheckIn} /> : null}
      <MenuButton
        nested
        icon={ImageIcon}
        label="NodeImage API Key"
        value={nodeImageApiKeySaved ? '已保存，NodeSeek 图片上传可用' : '未保存，NodeSeek 图片上传不可用'}
        expanded={showNodeImagePanel}
        styles={styles}
        theme={theme}
        onPress={() => setShowNodeImagePanel((value) => !value)}
      />
      {showNodeImagePanel ? (
        <View style={styles.stack}>
          <Text style={styles.meta}>通过 NodeSeek 授权自动保存；手动粘贴只作备用。</Text>
          <View style={styles.actions}>
            <AppButton
              label="自动授权 / 重新授权"
              styles={styles}
              disabled={nodeImageApiKeyBusy}
              onPress={onAuthorizeNodeImageApiKey}
            />
            <AppButton
              label="清除 Key"
              variant="ghost"
              styles={styles}
              disabled={nodeImageApiKeyBusy || !nodeImageApiKeySaved}
              onPress={onClearNodeImageApiKey}
            />
            <AppButton
              label={showManualNodeImageKey ? '收起手动备用' : '手动粘贴备用'}
              variant="ghost"
              styles={styles}
              onPress={() => setShowManualNodeImageKey((value) => !value)}
            />
          </View>
          {showManualNodeImageKey ? (
            <>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="NodeImage API Key"
                placeholderTextColor={theme.muted}
                secureTextEntry
                style={styles.input}
                value={nodeImageApiKeyDraft}
                onChangeText={setNodeImageApiKeyDraft}
              />
              <View style={styles.actions}>
                <AppButton
                  label={nodeImageApiKeyBusy ? '保存中' : '保存 Key'}
                  styles={styles}
                  disabled={nodeImageApiKeyBusy || !nodeImageApiKeyDraft.trim()}
                  onPress={() => {
                    onSaveNodeImageApiKey(nodeImageApiKeyDraft);
                    setNodeImageApiKeyDraft('');
                  }}
                />
              </View>
            </>
          ) : null}
        </View>
      ) : null}
      <LoginWebViewModal
        visible={showLoginPanel}
        title="NodeSeek 登录 / 验证"
        subtitle={nodeSeekSession.summaryLabel}
        loading={!webViewBlockMessage && loadingLoginPage}
        loadingText="正在打开 NodeSeek..."
        error={webViewBlockMessage || webViewError}
        styles={styles}
        theme={theme}
        onClose={() => onShowLoginPanelChange(false)}
        actions={(
          <View style={styles.actions}>
            {credentialSaved ? <AppButton label="填入已保存登录信息" styles={styles} disabled={credentialFillPending} onPress={onRequestCredentialFill} /> : null}
            <AppButton
              testID={webViewReadyForReplay && !webViewError && !webViewBlockMessage ? 'nodeseek-login-webview-ready' : undefined}
              label={checking ? '检测中' : '检测登录'}
              styles={styles}
              disabled={checking}
              onPress={onCheckLogin}
            />
            <AppButton label="清除登录" variant="danger" styles={styles} onPress={onClearLogin} />
            <AppButton label="刷新页面" variant="ghost" styles={styles} onPress={refreshWebView} />
          </View>
        )}
      >
        {showLoginPanel && accountExpanded && !webViewBlockMessage ? (
            <WebView
              key={`nodeseek-login-${webViewKey}-${credentialAttempt}`}
              ref={webViewRef}
              source={{ uri: loginFormMode ? LOGIN_FORM_ADAPTERS.nodeseek.loginUrl : NODESEEK_URL }}
              javaScriptCanOpenWindowsAutomatically={false}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              setSupportMultipleWindows={false}
              userAgent={nodeSeekWebViewUserAgent}
              injectedJavaScript={NODESEEK_LOGIN_PROBE_SCRIPT}
              onLoadEnd={(event) => {
                onSetLoadingLoginPage(false);
                if ('code' in event.nativeEvent) {
                  setWebViewReadyForReplay(false);
                  return;
                }
                webViewRef.current?.injectJavaScript(NODESEEK_REPLAY_READINESS_SCRIPT);
                onWebViewState('ready', credentialAttempt);
                setWebViewError('');
                webViewRef.current?.injectJavaScript(NODESEEK_LOGIN_PROBE_SCRIPT);
                if (loginFormMode) {
                  webViewRef.current?.injectJavaScript(LOGIN_FORM_ADAPTERS.nodeseek.probeScript(credentialAttempt));
                }
              }}
              onLoadStart={() => {
                onWebViewState('start', credentialAttempt);
                setWebViewError('');
                setWebViewNeedsRemount(false);
                setWebViewReadyForReplay(false);
                onSetLoadingLoginPage(true);
              }}
              onLoadProgress={(event) => {
                if (event.nativeEvent.progress > 0) {
                  webViewRef.current?.injectJavaScript(NODESEEK_REPLAY_READINESS_SCRIPT);
                }
              }}
              onMessage={(event) => {
                if (
                  event.nativeEvent.data === NODESEEK_REPLAY_READY_MESSAGE
                  && shouldOpenLoginWebViewUrl(event.nativeEvent.url, ['nodeseek.com'])
                ) {
                  setWebViewReadyForReplay(true);
                  return;
                }
                if (!onLoginFormMessage(event)) {
                  onHandleLoginMessage(event);
                }
              }}
              onError={(event) => {
                onWebViewState('error', credentialAttempt);
                onSetLoadingLoginPage(false);
                setWebViewReadyForReplay(false);
                setWebViewError(`NodeSeek 页面加载失败：${event.nativeEvent.description || '请检查模拟器网络后刷新页面。'}`);
              }}
              renderError={() => <View style={styles.webViewErrorPlaceholder} />}
              onRenderProcessGone={() => {
                onWebViewState('renderer-gone', credentialAttempt);
                onSetLoadingLoginPage(false);
                setWebViewReadyForReplay(false);
                setWebViewNeedsRemount(true);
                setWebViewError('NodeSeek 登录页面已停止，请刷新页面重试。');
              }}
              onShouldStartLoadWithRequest={handleNodeSeekLoginNavigation}
            />
        ) : null}
      </LoginWebViewModal>
    </>
  );
}

export function YaohuoLoginPanel({
  accountExpanded,
  checking,
  credentialAttempt,
  credentialFillPending,
  credentialSaved,
  yaohuoSession,
  loginFormMode,
  loadingYaohuoLoginPage,
  showYaohuoLoginPanel,
  styles,
  theme,
  yaohuoLoginPrompt,
  yaohuoWebViewRef,
  webViewBlockMessage,
  onCheckYaohuoLogin,
  onClearYaohuoLogin,
  handleYaohuoLoginNavigation,
  onLoginFormMessage,
  onRequestCredentialFill,
  onWebViewState,
  onSetLoadingYaohuoLoginPage,
  onShowYaohuoLoginPanelChange
}: {
  accountExpanded: boolean;
  checking: boolean;
  credentialAttempt: number;
  credentialFillPending: boolean;
  credentialSaved: boolean;
  yaohuoSession: SiteSessionViewModel;
  loginFormMode: boolean;
  loadingYaohuoLoginPage: boolean;
  showYaohuoLoginPanel: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  yaohuoLoginPrompt: string;
  yaohuoWebViewRef: RefObject<WebView | null>;
  webViewBlockMessage: string;
  onCheckYaohuoLogin: () => void;
  onClearYaohuoLogin: () => void;
  handleYaohuoLoginNavigation: (request: LoginNavigationRequest) => boolean;
  onLoginFormMessage: (event: WebViewMessageEvent) => boolean;
  onRequestCredentialFill: () => void;
  onWebViewState: (state: 'start' | 'ready' | 'error' | 'renderer-gone' | 'timeout', attempt?: number) => void;
  onSetLoadingYaohuoLoginPage: (value: boolean) => void;
  onShowYaohuoLoginPanelChange: (value: boolean) => void;
}) {
  const [webViewError, setWebViewError] = useState('');
  const [webViewKey, setWebViewKey] = useState(0);
  const [webViewNeedsRemount, setWebViewNeedsRemount] = useState(false);

  useEffect(() => {
    if (!showYaohuoLoginPanel) {
      setWebViewError('');
      setWebViewNeedsRemount(false);
    }
  }, [showYaohuoLoginPanel]);

  useEffect(() => {
    if (!showYaohuoLoginPanel || !loadingYaohuoLoginPage || webViewBlockMessage) {
      return undefined;
    }
    const timeout = setTimeout(() => {
      onWebViewState('timeout', credentialAttempt);
      onSetLoadingYaohuoLoginPage(false);
      setWebViewError('妖火页面打开超时：请检查模拟器网络后刷新页面。');
    }, LOGIN_WEBVIEW_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [credentialAttempt, loadingYaohuoLoginPage, onSetLoadingYaohuoLoginPage, onWebViewState, showYaohuoLoginPanel, webViewBlockMessage]);

  const refreshWebView = () => {
    setWebViewError('');
    onSetLoadingYaohuoLoginPage(true);
    if (webViewNeedsRemount) {
      setWebViewNeedsRemount(false);
      setWebViewKey((current) => current + 1);
      return;
    }
    yaohuoWebViewRef.current?.reload();
  };

  return (
    <>
      <LoginWebViewModal
        visible={showYaohuoLoginPanel}
        title="妖火登录"
        subtitle={yaohuoSession.summaryLabel}
        loading={!webViewBlockMessage && loadingYaohuoLoginPage}
        loadingText="正在打开妖火..."
        error={webViewBlockMessage || webViewError}
        styles={styles}
        theme={theme}
        onClose={() => onShowYaohuoLoginPanelChange(false)}
        actions={(
          <View style={styles.actions}>
            {credentialSaved ? <AppButton label="填入已保存登录信息" styles={styles} disabled={credentialFillPending} onPress={onRequestCredentialFill} /> : null}
            <AppButton label={checking ? '检测中' : '检测登录'} styles={styles} disabled={checking} onPress={onCheckYaohuoLogin} />
            <AppButton label="清除登录" variant="danger" styles={styles} onPress={onClearYaohuoLogin} />
            <AppButton label="刷新页面" variant="ghost" styles={styles} onPress={refreshWebView} />
          </View>
        )}
      >
        {showYaohuoLoginPanel && accountExpanded && !webViewBlockMessage ? (
          <View style={styles.flex}>
            {yaohuoLoginPrompt ? <Text style={styles.meta}>{yaohuoLoginPrompt}</Text> : null}
            <WebView
              style={styles.flex}
              key={`yaohuo-login-${webViewKey}-${credentialAttempt}`}
              ref={yaohuoWebViewRef}
              source={{ uri: loginFormMode ? LOGIN_FORM_ADAPTERS.yaohuo.loginUrl : yaohuoSession.canWrite ? YAOHUO_SESSION_URL : YAOHUO_LOGIN_URL }}
              javaScriptCanOpenWindowsAutomatically={false}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              setSupportMultipleWindows={false}
              onLoadEnd={(event) => {
                onSetLoadingYaohuoLoginPage(false);
                if ('code' in event.nativeEvent) {
                  return;
                }
                onWebViewState('ready', credentialAttempt);
                setWebViewError('');
                if (loginFormMode) {
                  yaohuoWebViewRef.current?.injectJavaScript(LOGIN_FORM_ADAPTERS.yaohuo.probeScript(credentialAttempt));
                }
              }}
              onLoadStart={() => {
                onWebViewState('start', credentialAttempt);
                setWebViewError('');
                setWebViewNeedsRemount(false);
                onSetLoadingYaohuoLoginPage(true);
              }}
              onMessage={(event) => { onLoginFormMessage(event); }}
              onError={(event) => {
                onWebViewState('error', credentialAttempt);
                onSetLoadingYaohuoLoginPage(false);
                setWebViewError(`妖火页面加载失败：${event.nativeEvent.description || '请检查模拟器网络后刷新页面。'}`);
              }}
              renderError={() => <View style={styles.webViewErrorPlaceholder} />}
              onRenderProcessGone={() => {
                onWebViewState('renderer-gone', credentialAttempt);
                onSetLoadingYaohuoLoginPage(false);
                setWebViewNeedsRemount(true);
                setWebViewError('妖火登录页面已停止，请刷新页面重试。');
              }}
              onShouldStartLoadWithRequest={handleYaohuoLoginNavigation}
            />
          </View>
        ) : null}
      </LoginWebViewModal>
    </>
  );
}

export { LinuxDoLevelPanel };

export function AppearancePanel({
  settings,
  showSettingsPanel,
  styles,
  onUpdateSettings
}: {
  settings: ReaderSettings;
  showSettingsPanel: boolean;
  styles: ReturnType<typeof createStyles>;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
}) {
  return (
    <View style={styles.stack}>
      {showSettingsPanel ? (
        <SettingsPanel settings={settings} styles={styles} onUpdateSettings={onUpdateSettings} />
      ) : null}
    </View>
  );
}

function SettingsPanel({
  settings,
  styles,
  onUpdateSettings
}: {
  settings: ReaderSettings;
  styles: ReturnType<typeof createStyles>;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
}) {
  return (
    <View style={styles.appearanceSettings}>
      <View style={styles.appearanceSection}>
        <Text style={styles.appearanceSectionTitle}>显示</Text>
        <SegmentedSetting
          title="主题"
          items={[{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }]}
          value={settings.theme}
          styles={styles}
          onChange={(value) => onUpdateSettings({ theme: value as ReaderSettings['theme'] })}
        />
      </View>

      <View style={styles.appearanceSection}>
        <Text style={styles.appearanceSectionTitle}>阅读</Text>
        <FontScaleSetting value={settings.fontScale} styles={styles} onChange={(fontScale) => onUpdateSettings({ fontScale })} />
        <SegmentedSetting
          divided
          title="行距"
          items={[{ value: 'compact', label: '紧凑' }, { value: 'standard', label: '标准' }, { value: 'loose', label: '宽松' }]}
          value={settings.lineHeight}
          styles={styles}
          onChange={(value) => onUpdateSettings({ lineHeight: value as ReaderSettings['lineHeight'] })}
        />
        <SegmentedSetting
          divided
          title="正文宽度"
          items={[{ value: 'narrow', label: '窄' }, { value: 'standard', label: '标准' }, { value: 'wide', label: '宽' }]}
          value={settings.contentWidth}
          styles={styles}
          onChange={(value) => onUpdateSettings({ contentWidth: value as ReaderSettings['contentWidth'] })}
        />
        <SegmentedSetting
          divided
          title="字体"
          items={[{ value: 'sans', label: '无衬线' }, { value: 'serif', label: '衬线' }]}
          value={settings.fontFamily}
          styles={styles}
          onChange={(value) => onUpdateSettings({ fontFamily: value as ReaderSettings['fontFamily'] })}
        />
      </View>

      <View style={styles.appearanceSection}>
        <Text style={styles.appearanceSectionTitle}>列表</Text>
        <SegmentedSetting
          title="列表密度"
          items={[{ value: 'compact', label: '紧凑' }, { value: 'standard', label: '标准' }, { value: 'loose', label: '宽松' }]}
          value={settings.listDensity}
          styles={styles}
          onChange={(value) => onUpdateSettings({ listDensity: value as ReaderSettings['listDensity'] })}
        />
      </View>
    </View>
  );
}

function SegmentedSetting({
  divided = false,
  items,
  styles,
  title,
  value,
  onChange
}: {
  divided?: boolean;
  items: Array<{ value: string; label: string }>;
  styles: ReturnType<typeof createStyles>;
  title: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={[styles.appearanceSettingRow, divided && styles.appearanceSettingRowDivided]}>
      <Text style={styles.appearanceSettingLabel}>{title}</Text>
      <View style={styles.appearanceSegmentedControl}>
        {items.map((item) => {
          const selected = item.value === value;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={item.value}
              style={[styles.appearanceSegment, selected && styles.appearanceSegmentActive]}
              onPress={() => {
                triggerPressFeedback();
                onChange(item.value);
              }}
            >
              <Text style={[styles.appearanceSegmentText, selected && styles.appearanceSegmentTextActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function FontScaleSetting({
  styles,
  value,
  onChange
}: {
  styles: ReturnType<typeof createStyles>;
  value: number;
  onChange: (value: number) => void;
}) {
  const [draftValue, setDraftValue] = useState(value);
  const [trackWidth, setTrackWidth] = useState(0);
  const draftValueRef = useRef(value);
  const progressValue = useRef(new Animated.Value((value - FONT_SCALE_MIN) / (FONT_SCALE_MAX - FONT_SCALE_MIN))).current;
  const sliderRef = useRef<View>(null);
  const trackLeftRef = useRef(0);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useCommittedRef(onChange);
  const percent = Math.round(draftValue * 100);
  const thumbTranslateX = useMemo(() => Animated.multiply(progressValue, trackWidth), [progressValue, trackWidth]);

  useEffect(() => {
    draftValueRef.current = value;
    setDraftValue(value);
    progressValue.setValue((value - FONT_SCALE_MIN) / (FONT_SCALE_MAX - FONT_SCALE_MIN));
  }, [progressValue, value]);

  useEffect(() => () => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      onChangeRef.current(draftValueRef.current);
    }
  }, []);

  const animateProgress = (nextValue: number) => {
    Animated.timing(progressValue, {
      duration: 120,
      easing: Easing.out(Easing.cubic),
      toValue: (nextValue - FONT_SCALE_MIN) / (FONT_SCALE_MAX - FONT_SCALE_MIN),
      useNativeDriver: true
    }).start();
  };
  const updateDraftValue = (nextValue: number, animate = true) => {
    if (animate) {
      animateProgress(nextValue);
    }
    if (draftValueRef.current === nextValue) {
      return;
    }
    draftValueRef.current = nextValue;
    setDraftValue(nextValue);
  };
  const clearPendingCommit = () => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  };
  const scheduleCommit = (nextValue: number) => {
    clearPendingCommit();
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      onChange(nextValue);
    }, 300);
  };
  const valueFromPageX = (pageX: number) => fontScaleFromSliderPosition(pageX - trackLeftRef.current, trackWidth);
  const setStep = (direction: -1 | 1) => {
    const nextValue = normalizeFontScale(draftValueRef.current + direction * FONT_SCALE_STEP);
    updateDraftValue(nextValue);
    scheduleCommit(nextValue);
  };
  const updatePosition = (pageX: number) => {
    const position = pageX - trackLeftRef.current;
    progressValue.stopAnimation();
    progressValue.setValue(trackWidth > 0 ? Math.max(0, Math.min(1, position / trackWidth)) : 0);
    updateDraftValue(fontScaleFromSliderPosition(position, trackWidth), false);
  };
  const commitPosition = (pageX: number) => {
    clearPendingCommit();
    const nextValue = valueFromPageX(pageX);
    updateDraftValue(nextValue);
    scheduleCommit(nextValue);
  };
  const sliderGesture = Gesture.Pan()
    .minDistance(0)
    .runOnJS(true)
    .onBegin(({ absoluteX }) => {
      clearPendingCommit();
      sliderRef.current?.measureInWindow((x) => {
        trackLeftRef.current = x;
        updatePosition(absoluteX);
      });
    })
    .onUpdate(({ absoluteX }) => updatePosition(absoluteX))
    .onEnd(({ absoluteX }) => commitPosition(absoluteX))
    .onFinalize((_event, success) => {
      if (!success) {
        scheduleCommit(draftValueRef.current);
      }
    });

  return (
    <View style={styles.appearanceFontScaleBlock}>
      <View style={styles.appearanceFontScaleHeader}>
        <Text style={styles.appearanceSettingLabel}>字号</Text>
        <Text style={styles.appearanceFontScaleValue}>字号 {percent}%</Text>
      </View>
      <View style={styles.appearanceSliderRow}>
        <Pressable
          accessibilityLabel="减小字号"
          accessibilityRole="button"
          accessibilityState={{ disabled: draftValue <= FONT_SCALE_MIN }}
          disabled={draftValue <= FONT_SCALE_MIN}
          style={[styles.appearanceStepButton, draftValue <= FONT_SCALE_MIN && styles.appearanceControlDisabled]}
          onPress={() => {
            triggerPressFeedback();
            setStep(-1);
          }}
        >
          <Text style={styles.appearanceStepButtonText}>−</Text>
        </Pressable>
        <GestureDetector gesture={sliderGesture}>
          <View
            ref={sliderRef}
            accessible
            accessibilityActions={[{ name: 'decrement', label: '减小字号' }, { name: 'increment', label: '增大字号' }]}
            accessibilityLabel="字号"
            accessibilityRole="adjustable"
            accessibilityValue={{ min: 85, max: 140, now: percent, text: `字号 ${percent}%` }}
            style={styles.appearanceSlider}
            onAccessibilityAction={({ nativeEvent }) => setStep(nativeEvent.actionName === 'increment' ? 1 : -1)}
            onLayout={({ nativeEvent }) => {
              setTrackWidth(nativeEvent.layout.width);
              sliderRef.current?.measureInWindow((x) => {
                trackLeftRef.current = x;
              });
            }}
          >
            <View style={styles.appearanceSliderTrack} />
            <Animated.View style={[styles.appearanceSliderFill, { transform: [{ scaleX: progressValue }] }]} />
            <Animated.View style={[styles.appearanceSliderThumb, { transform: [{ translateX: thumbTranslateX }] }]} />
          </View>
        </GestureDetector>
        <Pressable
          accessibilityLabel="增大字号"
          accessibilityRole="button"
          accessibilityState={{ disabled: draftValue >= FONT_SCALE_MAX }}
          disabled={draftValue >= FONT_SCALE_MAX}
          style={[styles.appearanceStepButton, draftValue >= FONT_SCALE_MAX && styles.appearanceControlDisabled]}
          onPress={() => {
            triggerPressFeedback();
            setStep(1);
          }}
        >
          <Text style={styles.appearanceStepButtonText}>＋</Text>
        </Pressable>
      </View>
    </View>
  );
}

