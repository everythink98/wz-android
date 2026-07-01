import * as SecureStore from 'expo-secure-store';

export const NODEIMAGE_API_KEY_STORAGE_KEY = 'nodeimage-api-key';

export function normalizeNodeImageApiKey(value: string) {
  return String(value || '').trim();
}

export async function loadNodeImageApiKey() {
  return normalizeNodeImageApiKey(await SecureStore.getItemAsync(NODEIMAGE_API_KEY_STORAGE_KEY) || '');
}

export async function saveNodeImageApiKey(value: string) {
  const apiKey = normalizeNodeImageApiKey(value);
  if (!apiKey) {
    throw new Error('请输入 NodeImage API Key');
  }
  await SecureStore.setItemAsync(NODEIMAGE_API_KEY_STORAGE_KEY, apiKey);
}

export async function clearNodeImageApiKey() {
  await SecureStore.deleteItemAsync(NODEIMAGE_API_KEY_STORAGE_KEY);
}
