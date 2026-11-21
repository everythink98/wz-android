import { createContext, useContext, useMemo } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import { packetCoverDocument } from './linuxDoPacketDocument';

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
  return (
    <View testID="topic-image-frame" pointerEvents="none" style={dimensions}>
      {viewer.active ? (
        <WebView
          key={JSON.stringify([cover, viewer.username, viewer.scope, viewer.revision])}
          testID="linuxdo-packet-cover"
          source={source}
          style={styles.cover}
          containerStyle={styles.cover}
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={({ url }) => url === source.baseUrl || url === 'about:blank'}
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
