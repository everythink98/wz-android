import AsyncStorage from '@react-native-async-storage/async-storage';

export type NodeSeekPollJournalEntry = {
  localId: string;
  fingerprint: string;
  remoteId: string | null;
};

const KEY_PREFIX = 'wz:composer:nodeseek-polls:';

function storageKey(identityKey: string) {
  const clean = String(identityKey || '').trim();
  if (!clean.startsWith('nodeseek:')) throw new Error('NodeSeek 账号身份不正确');
  return `${KEY_PREFIX}${encodeURIComponent(clean)}`;
}

function validEntry(value: unknown): value is NodeSeekPollJournalEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Partial<NodeSeekPollJournalEntry>;
  return (
    typeof entry.localId === 'string' &&
    /^[A-Za-z0-9_-]{8,80}$/.test(entry.localId) &&
    typeof entry.fingerprint === 'string' &&
    /^[a-f0-9]{16}$/.test(entry.fingerprint) &&
    (entry.remoteId === null || (typeof entry.remoteId === 'string' && /^\d+$/.test(entry.remoteId)))
  );
}

async function readEntries(identityKey: string) {
  const raw = await AsyncStorage.getItem(storageKey(identityKey));
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw);
  if (
    !Array.isArray(parsed) ||
    parsed.length > 32 ||
    !parsed.every(validEntry) ||
    new Set(parsed.map((entry) => entry.localId)).size !== parsed.length
  ) {
    throw new Error('NodeSeek 投票事务记录已损坏，已阻止重复创建投票');
  }
  return parsed;
}

export async function readNodeSeekPollJournalEntry(identityKey: string, localId: string) {
  return (await readEntries(identityKey)).find((entry) => entry.localId === localId) || null;
}

export async function saveNodeSeekPollJournalEntry(identityKey: string, entry: NodeSeekPollJournalEntry) {
  if (!validEntry(entry)) throw new Error('NodeSeek 投票事务记录不正确');
  const entries = await readEntries(identityKey);
  const previous = entries.find((candidate) => candidate.localId === entry.localId);
  const saved =
    entry.remoteId === null && previous?.fingerprint === entry.fingerprint && previous.remoteId ? previous : entry;
  const next = [saved, ...entries.filter((candidate) => candidate.localId !== entry.localId)].slice(0, 32);
  await AsyncStorage.setItem(storageKey(identityKey), JSON.stringify(next));
}
