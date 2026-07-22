import { NativeModules } from 'react-native';
import { androidWebViewUserAgentFromReactNativeImport } from './androidWebViewUserAgentValue';

export const DEFAULT_ANDROID_WEBVIEW_USER_AGENT: string = androidWebViewUserAgentFromReactNativeImport({ NativeModules });
