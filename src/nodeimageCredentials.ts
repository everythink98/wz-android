import * as SecureStore from 'expo-secure-store';
import {
  advanceCredentialWriteGeneration,
  createCredentialWriteGate,
  enqueueCredentialWriteForGeneration,
  replaceCredentialWrite
} from './app/sessionControllerHelpers';

export const NODEIMAGE_API_KEY_STORAGE_KEY = 'nodeimage-api-key';

const nodeImageApiKeyWriteGate = createCredentialWriteGate();

export function normalizeNodeImageApiKey(value: string) {
  return String(value || '').trim();
}

export function currentNodeImageApiKeyGeneration() {
  return nodeImageApiKeyWriteGate.generation;
}

export function beginNodeImageApiKeyAuthorization() {
  return advanceCredentialWriteGeneration(nodeImageApiKeyWriteGate);
}

export function invalidateNodeImageApiKeyAuthorization() {
  advanceCredentialWriteGeneration(nodeImageApiKeyWriteGate);
}

export async function loadNodeImageApiKey() {
  for (;;) {
    const generation = currentNodeImageApiKeyGeneration();
    let value: string | null;
    try {
      value = await SecureStore.getItemAsync(NODEIMAGE_API_KEY_STORAGE_KEY);
    } catch (error) {
      if (generation !== currentNodeImageApiKeyGeneration()) {
        continue;
      }
      throw error;
    }
    if (generation === currentNodeImageApiKeyGeneration()) {
      return normalizeNodeImageApiKey(value || '');
    }
  }
}

export async function saveNodeImageApiKey(value: string) {
  const apiKey = normalizeNodeImageApiKey(value);
  if (!apiKey) {
    throw new Error('请输入 NodeImage API Key');
  }
  return replaceCredentialWrite(nodeImageApiKeyWriteGate, async () => {
    await SecureStore.setItemAsync(NODEIMAGE_API_KEY_STORAGE_KEY, apiKey);
    return apiKey;
  });
}

export async function saveNodeImageApiKeyForGeneration(generation: number, value: string) {
  const apiKey = normalizeNodeImageApiKey(value);
  if (!apiKey) {
    throw new Error('请输入 NodeImage API Key');
  }
  return enqueueCredentialWriteForGeneration(nodeImageApiKeyWriteGate, generation, async () => {
    await SecureStore.setItemAsync(NODEIMAGE_API_KEY_STORAGE_KEY, apiKey);
    return apiKey;
  });
}

export async function restoreNodeImageApiKeyAfterCanceledAuthorization(value: string) {
  const apiKey = normalizeNodeImageApiKey(value);
  return replaceCredentialWrite(nodeImageApiKeyWriteGate, async () => {
    if (apiKey) {
      await SecureStore.setItemAsync(NODEIMAGE_API_KEY_STORAGE_KEY, apiKey);
    } else {
      await SecureStore.deleteItemAsync(NODEIMAGE_API_KEY_STORAGE_KEY);
    }
    return apiKey;
  });
}

export async function clearNodeImageApiKey() {
  return replaceCredentialWrite(nodeImageApiKeyWriteGate, async () => {
    await SecureStore.deleteItemAsync(NODEIMAGE_API_KEY_STORAGE_KEY);
    return true;
  });
}
