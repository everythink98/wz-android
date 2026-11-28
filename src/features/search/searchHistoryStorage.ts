import AsyncStorage from '@react-native-async-storage/async-storage';
import { searchHistoryFromRaw } from './history';

const STORAGE_KEY = 'reader-search-history';

type SearchHistoryPreload = { request: Promise<string[]>; entries?: string[] };

let inFlight: Promise<string[]> | undefined;
let preload: SearchHistoryPreload | undefined;
let searchHasRead = false;

function readHistory() {
  inFlight ??= AsyncStorage.getItem(STORAGE_KEY)
    .then(searchHistoryFromRaw)
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}

export function preloadSearchHistory() {
  if (searchHasRead || preload) return;
  const primed: SearchHistoryPreload = { request: readHistory() };
  preload = primed;
  void primed.request.then(
    (entries) => {
      primed.entries = entries;
    },
    () => {
      if (preload === primed) preload = undefined;
    }
  );
}

export function peekPreloadedSearchHistory() {
  return preload?.entries;
}

export function consumeSearchHistoryPreload() {
  searchHasRead = true;
  const request = preload?.request;
  preload = undefined;
  return request;
}

export function readStoredSearchHistory() {
  return consumeSearchHistoryPreload() ?? readHistory();
}

export function writeStoredSearchHistory(entries: string[]) {
  return AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}
