import { memo } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { AppButton } from '../components/AppControls';
import { LoginWebViewModal } from '../components/LoginWebViewModal';
import type { LoginNavigationRequest } from '../appTypes';
import type { createStyles, ReaderTheme } from '../theme';
import type { NodeImageAuthModalController } from './useNodeImageAuthController';

export const NodeImageAuthModal = memo(function NodeImageAuthModal({
  controller,
  handleNavigation,
  styles,
  theme,
  userAgent,
  webViewBlockMessage
}: {
  controller: NodeImageAuthModalController;
  handleNavigation: (request: LoginNavigationRequest) => boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  userAgent: string;
  webViewBlockMessage: string;
}) {
  return (
    <LoginWebViewModal
      visible={controller.visible}
      title="NodeImage 授权"
      subtitle="通过 NodeSeek 授权后自动保存 Key"
      loading={!webViewBlockMessage && controller.loading}
      loadingText="正在打开 NodeImage..."
      error={webViewBlockMessage || controller.error}
      styles={styles}
      theme={theme}
      onClose={controller.close}
      actions={(
        <View style={styles.actions}>
          <AppButton label="刷新页面" variant="ghost" styles={styles} onPress={() => controller.webViewRef.current?.reload()} />
        </View>
      )}
    >
      {controller.visible && !webViewBlockMessage ? (
        <WebView
          ref={controller.webViewRef}
          source={{ uri: controller.url }}
          javaScriptCanOpenWindowsAutomatically={false}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          setSupportMultipleWindows={false}
          userAgent={userAgent}
          injectedJavaScript={controller.probeScript}
          onLoadStart={() => {
            controller.setError('');
            controller.setLoading(true);
          }}
          onLoadEnd={(event) => {
            controller.setLoading(false);
            if ('code' in event.nativeEvent) {
              return;
            }
            controller.webViewRef.current?.injectJavaScript(controller.probeScript);
          }}
          onMessage={controller.handleMessage}
          onError={(event) => {
            controller.setLoading(false);
            controller.setError(`NodeImage 页面加载失败：${event.nativeEvent.description || '请检查模拟器网络后刷新页面。'}`);
          }}
          renderError={() => <View style={styles.webViewErrorPlaceholder} />}
          onRenderProcessGone={() => {
            controller.setLoading(false);
            controller.setError('NodeImage 授权页面已停止，请刷新页面重试。');
          }}
          onShouldStartLoadWithRequest={handleNavigation}
        />
      ) : null}
    </LoginWebViewModal>
  );
});
