import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import { packetCoverDocument } from '@/platform/media/linuxDoPacketDocument';
import { LINUX_DO_PACKET_ORIGIN } from '@/domain/forum/linuxDoPacket';

export const LinuxDoPacketViewer = createContext({ active: true, username: '', revision: 0, scope: '' });

export function LinuxDoPacketCover({
  cover,
  dimensions,
  settle
}: {
  cover: string;
  dimensions: ViewStyle;
  settle: (outcome: 'displayed' | 'error') => void;
}) {
  const viewer = useContext(LinuxDoPacketViewer);
  const source = useMemo(() => packetCoverDocument(cover, viewer.username), [cover, viewer.username]);
  const webview = useRef<WebView>(null);
  const revision = useRef(viewer.revision);
  useEffect(() => {
    if (revision.current !== viewer.revision) webview.current?.postMessage('refresh');
    revision.current = viewer.revision;
  }, [viewer.revision]);
  return (
    <View testID="topic-image-frame" pointerEvents="none" style={dimensions}>
      {viewer.active ? (
        <WebView
          ref={webview}
          key={JSON.stringify([cover, viewer.username, viewer.scope])}
          testID="linuxdo-packet-cover"
          source={source}
          style={styles.cover}
          containerStyle={styles.cover}
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={({ url }) =>
            url === source.baseUrl || url === LINUX_DO_PACKET_ORIGIN || url === 'about:blank'
          }
          cacheMode="LOAD_NO_CACHE"
          sharedCookiesEnabled
          thirdPartyCookiesEnabled={false}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          mixedContentMode="never"
          javaScriptCanOpenWindowsAutomatically={false}
          scrollEnabled={false}
          onMessage={({ nativeEvent }) => {
            if (nativeEvent.data === 'displayed' || nativeEvent.data === 'error') settle(nativeEvent.data);
          }}
          onError={() => settle('error')}
          onRenderProcessGone={() => settle('error')}
          renderError={() => <Text>红包封面加载失败</Text>}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ cover: { backgroundColor: 'transparent' } });
