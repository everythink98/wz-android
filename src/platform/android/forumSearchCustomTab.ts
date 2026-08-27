import * as WebBrowser from 'expo-web-browser';
import { NativeModules } from 'react-native';
import { isExternalForumSearchUrl } from '@/domain/forum/externalSearch';

type ForumSearchCustomTabModule = {
  open: (url: string) => Promise<boolean>;
};

export async function openForumSearchCustomTab(url: string) {
  if (!isExternalForumSearchUrl(url)) {
    throw new Error('外部搜索地址无效');
  }
  const module = NativeModules.ForumSearchCustomTabModule as ForumSearchCustomTabModule | undefined;
  if (module) {
    try {
      if (await module.open(url)) return true;
    } catch {
      // Fall back to Expo's regular browser path below.
    }
  }
  await WebBrowser.openBrowserAsync(url);
  return false;
}
