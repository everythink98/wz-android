import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { RecoverableEmptyState } from '@/ui/controls/FeedbackStates';
import { LogIn } from 'lucide-react-native';
import { WebView } from 'react-native-webview';
import { allowLinuxDoPacketNavigation, LINUX_DO_PACKET_ORIGIN } from '@/domain/forum/linuxDoPacket';
import { LoginWebViewAction, LoginWebViewModal } from '@/ui/navigation/LoginWebViewModal';
import { packetSessionDocument } from '@/platform/media/linuxDoPacketDocument';

type PageState = 'checking' | 'opening' | 'open' | 'mismatch' | 'connecting' | 'failed';
const returnPath = '/?wz_packet_connected=1';
const returnUrl = LINUX_DO_PACKET_ORIGIN + returnPath;
const connectUrl = LINUX_DO_PACKET_ORIGIN + '/api/auth/login?returnTo=' + encodeURIComponent(returnPath);

export function LinuxDoPacketPage({
  url,
  username,
  blockMessage,
  onClose
}: {
  url: string;
  username: string;
  blockMessage: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<PageState>('checking');
  const session = useMemo(() => packetSessionDocument(username), [username]);
  const checking = state === 'checking';
  const loading = !blockMessage && (checking || state === 'opening');
  const [failure, setFailure] = useState('红包页加载失败，请重试。');
  const mismatchMessage = username
    ? '红包站已登录其他账号。请用当前 LINUX DO 账号重新连接。'
    : '请先在「我的」登录领取红包时使用的 LINUX DO 账号。';
  const onReturned = (value: string) => {
    if (
      state !== 'connecting' ||
      !value.startsWith(LINUX_DO_PACKET_ORIGIN + '/') ||
      value.startsWith(LINUX_DO_PACKET_ORIGIN + '/api/auth/')
    )
      return false;
    if (value !== returnUrl) setFailure('账号连接未完成，请重试。');
    setState(value === returnUrl ? 'checking' : 'failed');
    return true;
  };
  return (
    <LoginWebViewModal
      visible
      title="红包站"
      subtitle="使用领取时的 LINUX DO 账号登录，关闭后封面会刷新。"
      showContentWhileLoading
      loading={loading}
      loadingText={checking ? '正在核对红包站账号…' : '正在打开红包页…'}
      error={blockMessage || (state === 'mismatch' ? mismatchMessage : '')}
      onClose={onClose}
      primaryAction={
        state === 'mismatch' && username && !blockMessage ? (
          <LoginWebViewAction icon={LogIn} primary label="连接当前账号" onPress={() => setState('connecting')} />
        ) : undefined
      }
    >
      {!blockMessage && state === 'failed' ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <RecoverableEmptyState message={failure} actionLabel="重新加载" onAction={() => setState('checking')} />
        </View>
      ) : null}
      {!blockMessage && (checking || state === 'opening' || state === 'open' || state === 'connecting') ? (
        <WebView<unknown>
          style={{ backgroundColor: 'transparent' }}
          containerStyle={{ backgroundColor: 'transparent', opacity: loading ? 0 : 1 }}
          importantForAccessibility={loading ? 'no-hide-descendants' : 'auto'}
          testID={checking ? 'linuxdo-packet-session' : 'linuxdo-packet-page'}
          source={checking ? session : { uri: state === 'connecting' ? connectUrl : url }}
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={(request) => {
            if (checking)
              return (
                request.url === session.baseUrl ||
                request.url === LINUX_DO_PACKET_ORIGIN ||
                request.url === 'about:blank'
              );
            if (onReturned(request.url)) return false;
            if (
              (state === 'open' || state === 'opening') &&
              request.url.split('?')[0] === LINUX_DO_PACKET_ORIGIN + '/api/auth/login'
            ) {
              setState('connecting');
              return false;
            }
            return (
              allowLinuxDoPacketNavigation(request.url) ||
              (request.isTopFrame === false && request.url.startsWith('https://challenges.cloudflare.com/'))
            );
          }}
          onNavigationStateChange={
            state === 'connecting'
              ? (event) => {
                  onReturned(event.url);
                }
              : undefined
          }
          onMessage={
            checking
              ? ({ nativeEvent }) => {
                  if (
                    nativeEvent.url !== LINUX_DO_PACKET_ORIGIN &&
                    nativeEvent.url !== session.baseUrl &&
                    nativeEvent.url !== 'about:blank'
                  )
                    return;
                  const status = nativeEvent.data;
                  if (status === 'matching' || status === 'anonymous') setState('opening');
                  else if (status === 'mismatch') setState('mismatch');
                  else if (status === 'error' || /^http:[45]\d{2}$/.test(status)) {
                    setFailure(
                      status === 'error'
                        ? '暂时无法核对红包站账号，请重试。'
                        : `红包站账号核对失败（HTTP ${status.slice(5)}），请稍后重试。`
                    );
                    setState('failed');
                  }
                }
              : undefined
          }
          sharedCookiesEnabled
          thirdPartyCookiesEnabled={false}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          mixedContentMode="never"
          javaScriptCanOpenWindowsAutomatically={false}
          setSupportMultipleWindows={false}
          onLoad={({ nativeEvent }) => {
            if (
              state === 'opening' &&
              nativeEvent.url !== session.baseUrl &&
              allowLinuxDoPacketNavigation(nativeEvent.url)
            )
              setState('open');
          }}
          onError={() => {
            setFailure('红包页加载失败，请重试。');
            setState('failed');
          }}
          onRenderProcessGone={() => {
            setFailure('网页进程已停止，请重新加载红包页。');
            setState('failed');
          }}
        />
      ) : null}
    </LoginWebViewModal>
  );
}
