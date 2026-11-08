import { Linking } from 'react-native';
import { isHttpOrHttpsUrl } from '@/platform/media/imageRequestSource';
import { errorMessage } from '@/platform/network/errors';

export function openHttpUrl(
  url: string,
  notify: (message: string) => void,
  open: (destination: string) => Promise<unknown> = (destination) => Linking.openURL(destination)
) {
  if (!isHttpOrHttpsUrl(url)) {
    notify('仅支持打开 http/https 链接。');
    return;
  }
  void open(url).catch((error) => notify(errorMessage(error)));
}
