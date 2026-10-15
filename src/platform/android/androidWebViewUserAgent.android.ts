import { NativeModules } from 'react-native';
import type { NativeNetworkProxyModule } from '@/platform/network/networkProxy';
import { createDefaultWebViewUserAgentReader } from './androidWebViewUserAgentValue';

export const getDefaultAndroidWebViewUserAgent = createDefaultWebViewUserAgentReader(() => {
  const owner: NativeNetworkProxyModule | undefined = NativeModules.NetworkProxyModule;
  if (typeof owner?.getDefaultWebViewUserAgent !== 'function') throw new Error('默认浏览器身份读取不可用');
  return owner.getDefaultWebViewUserAgent();
});
