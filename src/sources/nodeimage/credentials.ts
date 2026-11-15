import * as SecureStore from 'expo-secure-store';
import {
  advanceCredentialWriteGeneration,
  createCredentialWriteGate,
  enqueueCredentialWriteForGeneration,
  replaceCredentialWrite
} from '@/platform/storage/credentialWriteGate';

export const NODEIMAGE_API_KEY_STORAGE_KEY = 'nodeimage-api-key';

const nodeImageApiKeyWriteGate = createCredentialWriteGate();
type CredentialPersistenceState = { phase: 'stable' } | { phase: 'restore-required'; previousValue: string | null };
let credentialPersistence: CredentialPersistenceState = { phase: 'stable' };

type NodeImageApiKeyCredential = Readonly<{
  version: 1;
  apiKey: string;
  ownership: Readonly<{ kind: 'unverified' }> | Readonly<{ kind: 'verified'; identityKey: string }>;
}>;

type NodeImageApiKeyUseStatus = 'confirmation-required' | 'identity-mismatch' | 'missing' | 'usable';

export function normalizeNodeImageApiKey(value: string) {
  return String(value || '').trim();
}

function unverifiedNodeImageCredential(apiKey: string): NodeImageApiKeyCredential {
  return {
    apiKey,
    ownership: { kind: 'unverified' },
    version: 1
  };
}

function verifiedNodeImageCredential(apiKey: string, identityKey: string): NodeImageApiKeyCredential {
  return {
    apiKey,
    ownership: { kind: 'verified', identityKey },
    version: 1
  };
}

function parseNodeImageCredential(rawValue: string | null): NodeImageApiKeyCredential | null {
  const raw = normalizeNodeImageApiKey(rawValue || '');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<NodeImageApiKeyCredential>;
    const apiKey = normalizeNodeImageApiKey(parsed.apiKey || '');
    if (parsed.version === 1 && apiKey && parsed.ownership?.kind === 'unverified') {
      return unverifiedNodeImageCredential(apiKey);
    }
    if (
      parsed.version === 1 &&
      apiKey &&
      parsed.ownership?.kind === 'verified' &&
      normalizeNodeImageApiKey(parsed.ownership.identityKey)
    ) {
      return verifiedNodeImageCredential(apiKey, normalizeNodeImageApiKey(parsed.ownership.identityKey));
    }
  } catch {
    // Legacy versions stored the API key as a plain string.
  }
  return unverifiedNodeImageCredential(raw);
}

async function writeNodeImageCredential(credential: NodeImageApiKeyCredential) {
  await SecureStore.setItemAsync(NODEIMAGE_API_KEY_STORAGE_KEY, JSON.stringify(credential));
}

// Called only within the credential write queue. This obligation survives failures in this process, not restarts.
async function restoreNodeImageCredential() {
  const persistence = credentialPersistence;
  if (persistence.phase === 'stable') return;
  if (persistence.previousValue === null) {
    await SecureStore.deleteItemAsync(NODEIMAGE_API_KEY_STORAGE_KEY);
  } else {
    await SecureStore.setItemAsync(NODEIMAGE_API_KEY_STORAGE_KEY, persistence.previousValue);
  }
  credentialPersistence = { phase: 'stable' };
}

export function nodeImageApiKeyUseStatus(
  credential: NodeImageApiKeyCredential | null,
  identityKey: string
): NodeImageApiKeyUseStatus {
  if (!credential) return 'missing';
  if (credential.ownership.kind === 'unverified') return 'confirmation-required';
  return credential.ownership.identityKey === identityKey ? 'usable' : 'identity-mismatch';
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

export async function loadNodeImageApiKeyCredential() {
  for (;;) {
    const generation = currentNodeImageApiKeyGeneration();
    const pendingWrites = nodeImageApiKeyWriteGate.queue;
    const isCurrent = () =>
      generation === currentNodeImageApiKeyGeneration() && pendingWrites === nodeImageApiKeyWriteGate.queue;
    await pendingWrites;
    if (!isCurrent()) continue;
    if (credentialPersistence.phase === 'restore-required') {
      const repairing = enqueueCredentialWriteForGeneration(
        nodeImageApiKeyWriteGate,
        generation,
        restoreNodeImageCredential
      );
      const repairQueue = nodeImageApiKeyWriteGate.queue;
      try {
        await repairing;
      } catch (error) {
        if (generation !== currentNodeImageApiKeyGeneration() || repairQueue !== nodeImageApiKeyWriteGate.queue) {
          continue;
        }
        throw error;
      }
      continue;
    }
    try {
      const rawValue = await SecureStore.getItemAsync(NODEIMAGE_API_KEY_STORAGE_KEY);
      if (isCurrent()) return parseNodeImageCredential(rawValue);
    } catch (error) {
      if (!isCurrent()) continue;
      throw error;
    }
  }
}

export async function loadNodeImageApiKey() {
  return (await loadNodeImageApiKeyCredential())?.apiKey || '';
}

export async function saveNodeImageApiKeyForGeneration(
  generation: number,
  value: string,
  authorizationOwner: string,
  settledOwner: string,
  isAuthorizationCurrent: () => boolean = () => true
) {
  const authorizedIdentityKey = confirmedNodeSeekOwner(authorizationOwner);
  const settledIdentityKey = confirmedNodeSeekOwner(settledOwner);
  if (!authorizedIdentityKey || !settledIdentityKey || authorizedIdentityKey !== settledIdentityKey) {
    return undefined;
  }
  const apiKey = normalizeNodeImageApiKey(value);
  if (!apiKey) {
    throw new Error('请输入 NodeImage API Key');
  }
  return enqueueCredentialWriteForGeneration(nodeImageApiKeyWriteGate, generation, async ({ isCurrent }) => {
    if (!isAuthorizationCurrent()) {
      return undefined;
    }
    await restoreNodeImageCredential();
    if (!isCurrent() || !isAuthorizationCurrent()) {
      return undefined;
    }
    const previousValue = await SecureStore.getItemAsync(NODEIMAGE_API_KEY_STORAGE_KEY);
    if (!isCurrent() || !isAuthorizationCurrent()) {
      return undefined;
    }
    credentialPersistence = { phase: 'restore-required', previousValue };
    await writeNodeImageCredential(verifiedNodeImageCredential(apiKey, settledIdentityKey));
    if (!isCurrent() || !isAuthorizationCurrent()) {
      await restoreNodeImageCredential();
      return undefined;
    }
    credentialPersistence = { phase: 'stable' };
    return apiKey;
  });
}

export async function clearNodeImageApiKey() {
  return replaceCredentialWrite(nodeImageApiKeyWriteGate, async () => {
    await SecureStore.deleteItemAsync(NODEIMAGE_API_KEY_STORAGE_KEY);
    credentialPersistence = { phase: 'stable' };
    return true;
  });
}

function confirmedNodeSeekOwner(identityKey: string | undefined) {
  const value = normalizeNodeImageApiKey(identityKey || '');
  if (!value.startsWith('nodeseek:')) {
    return '';
  }
  const owner = value.slice('nodeseek:'.length);
  return owner && owner !== 'anonymous' ? value : '';
}
