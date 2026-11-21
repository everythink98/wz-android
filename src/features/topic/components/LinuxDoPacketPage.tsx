import { useMemo, useState } from 'react';
import { LogIn, RefreshCw } from 'lucide-react-native';
import { WebView } from 'react-native-webview';
import { allowLinuxDoPacketNavigation, LINUX_DO_PACKET_ORIGIN } from '@/domain/forum/linuxDoPacket';
import { LoginWebViewAction, LoginWebViewModal } from '@/ui/navigation/LoginWebViewModal';
import { packetSessionDocument } from '../rendering/linuxDoPacketDocument';

type PageState = 'checking' | 'open' | 'mismatch' | 'connecting' | 'failed';
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
  const mismatchMessage = username
    ? '红包站已登录其他账号。请用当前 LINUX DO 账号重新连接。'
    : '请先在「我的」登录领取红包时使用的 LINUX DO 账号。';
  const onReturned = (value: string) => {
    if (state !== 'connecting' || value !== returnUrl) return false;
    setState('checking');
    return true;
  };
  return (
    <LoginWebViewModal
      visible
      title="红包站"
      subtitle="使用领取时的 LINUX DO 账号登录，关闭后封面会刷新。"
      loading={!blockMessage && checking}
      loadingText="正在核对红包站账号…"
      error={
        blockMessage || (state === 'failed' ? '红包页加载失败，请重试。' : state === 'mismatch' ? mismatchMessage : '')
      }
      onClose={onClose}
      primaryAction={
        state === 'mismatch' && username && !blockMessage ? (
          <LoginWebViewAction icon={LogIn} primary label="连接当前账号" onPress={() => setState('connecting')} />
        ) : undefined
      }
      refreshAction={
        state === 'failed' && !blockMessage ? (
          <LoginWebViewAction icon={RefreshCw} label="重新加载" onPress={() => setState('checking')} />
        ) : undefined
      }
    >
      {!blockMessage && (checking || state === 'open' || state === 'connecting') ? (
        <WebView<unknown>
          key={state}
          testID={checking ? 'linuxdo-packet-session' : 'linuxdo-packet-page'}
          source={checking ? session : { uri: state === 'connecting' ? connectUrl : url }}
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={(request) => {
            if (checking) return request.url === session.baseUrl || request.url === 'about:blank';
            if (onReturned(request.url)) return false;
            if (state === 'open' && request.url.split('?')[0] === LINUX_DO_PACKET_ORIGIN + '/api/auth/login') {
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
                  if (nativeEvent.url !== session.baseUrl && nativeEvent.url !== 'about:blank') return;
                  const status = nativeEvent.data;
                  if (status === 'matching' || status === 'anonymous') setState('open');
                  else if (status === 'mismatch') setState('mismatch');
                  else if (status === 'error') setState('failed');
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
          onError={() => setState('failed')}
          onRenderProcessGone={() => setState('failed')}
        />
      ) : null}
    </LoginWebViewModal>
  );
}
