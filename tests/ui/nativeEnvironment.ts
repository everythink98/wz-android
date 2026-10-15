import { NativeModules } from 'react-native';
import type { NotificationChannelGroupManager, NotificationChannelManager } from 'expo-notifications';

// Match our own Android build. jest-expo also supplies Expo Go's native module by default.
// Configure the native schema before public Expo imports so each owner can still mock its API.
const proxy = NativeModules.NativeUnimoduleProxy;
proxy.modulesConstants.ExponentConstants.executionEnvironment = 'bare';
delete proxy.exportedMethods.ExpoGo;
delete proxy.modulesConstants.ExpoGo;
delete NativeModules.ExpoGo;
delete globalThis.expo.modules.ExpoGo;

// SDK 57 registers this Android module; the bundled Jest schema has not included it yet.
const channels: NotificationChannelManager = {
  getNotificationChannelsAsync: jest.fn(async () => []),
  getNotificationChannelAsync: jest.fn(async () => null),
  setNotificationChannelAsync: jest.fn(async () => null),
  deleteNotificationChannelAsync: jest.fn(async () => undefined)
};
const channelGroups: NotificationChannelGroupManager = {
  getNotificationChannelGroupsAsync: jest.fn(async () => []),
  getNotificationChannelGroupAsync: jest.fn(async () => null),
  setNotificationChannelGroupAsync: jest.fn(async () => null),
  deleteNotificationChannelGroupAsync: jest.fn(async () => undefined)
};
for (const [name, module] of Object.entries({
  ExpoNotificationChannelManager: channels,
  ExpoNotificationChannelGroupManager: channelGroups,
  ExpoTopicSubscriptionModule: {
    subscribeToTopicAsync: jest.fn(async (_topic: string) => null),
    unsubscribeFromTopicAsync: jest.fn(async (_topic: string) => null)
  }
})) {
  proxy.modulesConstants[name] = { ...module };
  proxy.exportedMethods[name] = [];
  globalThis.expo.modules[name] = module;
}

NativeModules.ToastAndroid = {
  getConstants: () => ({ SHORT: 0, LONG: 1, TOP: 49, BOTTOM: 81, CENTER: 17 }),
  show: jest.fn(),
  showWithGravity: jest.fn(),
  showWithGravityAndOffset: jest.fn()
};

for (const name of ['RNCDatePicker', 'RNCTimePicker', 'RNCMaterialDatePicker', 'RNCMaterialTimePicker']) {
  NativeModules[name] = {
    open: jest.fn(async () => ({ action: 'dismissedAction', timestamp: 0, utcOffset: 0 })),
    dismiss: jest.fn(async () => true)
  };
}
