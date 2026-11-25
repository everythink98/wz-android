import { queryOptions, skipToken, useQuery, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { isLocalReaderFontFamily, type LocalReaderFont, type LocalReaderFontFamily } from '@/domain/reader/readerFonts';
import { errorMessage } from '@/platform/network/errors';
import {
  downloadReaderFont,
  listLocalReaderFonts,
  prepareLocalReaderFont,
  type DownloadableReaderFont,
  type ReaderFontDownloadProgress
} from '@/platform/storage/readerFonts';

export const localReaderFontCatalog = queryOptions({
  queryKey: ['reader-font-catalog'],
  queryFn: async ({ client }) =>
    (await listLocalReaderFonts()).filter(
      ({ family }) => client.getQueryData(localReaderFontRegistration(family).queryKey) !== false
    ),
  networkMode: 'always',
  staleTime: Infinity,
  gcTime: Infinity
});

export type ReaderFontTarget = 'interface' | 'reading';

type ReaderFontDownload = { target: ReaderFontTarget; family: LocalReaderFontFamily } & (
  { status: 'running'; progress: ReaderFontDownloadProgress } | { status: 'failed'; message: string }
);

export const readerFontDownload = queryOptions<ReaderFontDownload | null>({
  queryKey: ['reader-font-download'],
  queryFn: skipToken,
  gcTime: Infinity
});

export async function installReaderFont(client: QueryClient, font: DownloadableReaderFont, target: ReaderFontTarget) {
  const { queryKey } = readerFontDownload;
  if (client.getQueryData(queryKey)?.status === 'running') return null;

  const family = font.family;
  const publish = (progress: ReaderFontDownloadProgress) => {
    const running: ReaderFontDownload = { status: 'running', family, target, progress };
    client.setQueryData(queryKey, running);
  };
  publish({ phase: 'connecting' });
  try {
    const installed = await downloadReaderFont(font, publish);
    await rememberInstalledReaderFont(client, installed);
    client.setQueryData(queryKey, null);
    return installed;
  } catch (error) {
    const failed: ReaderFontDownload = { status: 'failed', family, target, message: errorMessage(error) };
    client.setQueryData(queryKey, failed);
    return null;
  }
}

export function localReaderFontRegistration(family: LocalReaderFontFamily | null) {
  return queryOptions({
    queryKey: ['reader-font-registration', family],
    queryFn: async ({ client }) => {
      if (!family) return false;
      const registered = await prepareLocalReaderFont(family);
      if (!registered) {
        client.setQueryData(localReaderFontCatalog.queryKey, (fonts) =>
          fonts?.filter((font) => font.family !== family)
        );
      }
      return registered;
    },
    enabled: family !== null,
    networkMode: 'always',
    staleTime: Infinity,
    gcTime: Infinity
  });
}

export async function rememberInstalledReaderFont(client: QueryClient, font: LocalReaderFont) {
  const registration = localReaderFontRegistration(font.family);
  client.setQueryDefaults(registration.queryKey, { gcTime: registration.gcTime });
  client.setQueryData(registration.queryKey, true);
  // An initial disk read may have started before installation. Merge after it settles.
  await client.fetchQuery(localReaderFontCatalog).catch(() => undefined);
  client.setQueryData(localReaderFontCatalog.queryKey, (fonts) =>
    fonts?.some(({ family }) => family === font.family) ? fonts : [...(fonts ?? []), font]
  );
}

export async function prepareSavedReaderFonts(client: QueryClient, settings: ReaderSettings) {
  const families = new Set([settings.fontFamily, settings.uiFontFamily].filter(isLocalReaderFontFamily));
  await Promise.all([...families].map((family) => client.fetchQuery(localReaderFontRegistration(family))));
}

export function useEffectiveReaderFontSettings(settings: ReaderSettings) {
  const localReading = isLocalReaderFontFamily(settings.fontFamily) ? settings.fontFamily : null;
  const localInterface = isLocalReaderFontFamily(settings.uiFontFamily) ? settings.uiFontFamily : null;
  const reading = useQuery(localReaderFontRegistration(localReading));
  const ui = useQuery(localReaderFontRegistration(localInterface));
  const fontFamily = localReading && !reading.data ? 'app' : settings.fontFamily;
  const uiFontFamily = localInterface && !ui.data ? 'app' : settings.uiFontFamily;
  return useMemo(
    () =>
      fontFamily === settings.fontFamily && uiFontFamily === settings.uiFontFamily
        ? settings
        : { ...settings, fontFamily, uiFontFamily },
    [fontFamily, settings, uiFontFamily]
  );
}
