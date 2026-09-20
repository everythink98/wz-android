import { useMemo, useState } from 'react';
import { Button, Text, View } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { exportReaderBackupJson, MAX_BACKUP_JSON_BYTES, parseReaderBackupJson } from '@/domain/reader/readerBackup';
import { saveBackupDocument } from '@/platform/storage/backupExport';
import { readBackupFileText } from '@/platform/storage/backupImportFile';
import { exportDiagnosticLog } from '@/platform/diagnostics/diagnosticFileStore';
import { saveImageUriToLibrary } from '@/platform/media/imageSave';
import { diagnosticBuildContext } from '@/platform/diagnostics/nativeDiagnosticJournal';

// Selected only by the isolated image-runtime instrumentation build.
export function PlatformExportsProof({ token }: { token: string }) {
  const [status, setStatus] = useState('platform-ready');
  const json = useMemo(() => {
    const data = createEmptyReaderData();
    data.history['nodeseek:91827'] = {
      topic: {
        source: 'nodeseek',
        id: '91827',
        title: '中文🙂备份边界',
        author: 'synthetic',
        category: '测试',
        url: 'https://www.nodeseek.com/post-91827-1',
        createdAt: '2026-09-19T00:00:00.000Z',
        replyCount: 0
      },
      savedAt: '2026-09-19T00:00:00.000Z',
      visitCount: 1
    };
    const content = exportReaderBackupJson(data);
    return content + ' '.repeat(MAX_BACKUP_JSON_BYTES - new TextEncoder().encode(content).length);
  }, []);
  const run = (name: string, action: () => Promise<unknown>) => {
    setStatus(`${name}-pending`);
    void action().then(
      (result) => {
        const receipt = new File(Paths.cache, 'platform-export-proof.json');
        receipt.create({ overwrite: true });
        receipt.write(
          JSON.stringify({
            ...diagnosticBuildContext(),
            token,
            name,
            result,
            isHermes: 'HermesInternal' in globalThis,
            isDev: __DEV__
          })
        );
        setStatus(`${name}-${typeof result === 'string' ? result : 'passed'}`);
      },
      (error: unknown) => setStatus(`${name}-error:${String(error)}`)
    );
  };
  return (
    <View>
      <Text>{status}</Text>
      <Button
        title="Platform save backup"
        onPress={() =>
          run('backup', async () => {
            const result = await saveBackupDocument(`备份🙂-forum-platform-proof-${token}.json`, json);
            return result.status;
          })
        }
      />
      <Button
        title="Platform import backup"
        onPress={() =>
          run('import', async () => {
            const result = await DocumentPicker.getDocumentAsync({
              type: 'application/json',
              copyToCacheDirectory: true
            });
            if (result.canceled) return 'canceled';
            const file = new File(result.assets[0].uri);
            try {
              const actual = await readBackupFileText(result.assets[0]);
              parseReaderBackupJson(actual);
              if (actual !== json) throw new Error('Saved backup bytes changed');
            } finally {
              if (file.exists) file.delete();
            }
            return 'passed';
          })
        }
      />
      <Button
        title="Platform concurrent backup"
        onPress={() =>
          run('concurrent', async () => {
            const first = saveBackupDocument(`备份🙂-forum-platform-proof-${token}.json`, json);
            try {
              await saveBackupDocument(`forum-platform-proof-extra-${token}.json`, json);
              throw new Error('Second export was incorrectly accepted');
            } catch (error) {
              if (!String(error).includes('已有备份')) throw error;
            }
            return (await first).status;
          })
        }
      />
      <Button
        title="Platform share diagnostic"
        onPress={() =>
          run('diagnostic', async () => {
            await exportDiagnosticLog({ appVersion: 'isolated-proof', versionCode: 1 });
            const directory = new Directory(Paths.document, 'diagnostic-exports');
            return { retainedFiles: directory.list().length };
          })
        }
      />
      <Button
        title="Platform save image"
        onPress={() =>
          run('image', async () => {
            await saveImageUriToLibrary('http://127.0.0.1:42189/asset.png', {
              mediaContext: { contentSource: null, sessionIdentity: 'public:0' }
            });
            return 'passed';
          })
        }
      />
    </View>
  );
}
