import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';

type AttachmentPickerOptions = NonNullable<DocumentPicker.DocumentPickerOptions['copyLimits']> & {
  type: string;
  multiple?: boolean;
  maxFilesMessage?: string;
};

export async function withPickedAttachmentCopies<T>(
  { type, multiple = false, maxFilesMessage, ...copyLimits }: AttachmentPickerOptions,
  consume: (result: DocumentPicker.DocumentPickerResult) => T | Promise<T>
): Promise<T> {
  const result = await DocumentPicker.getDocumentAsync({
    type,
    multiple,
    copyToCacheDirectory: true,
    copyLimits
  }).catch((error: unknown) => {
    if (
      maxFilesMessage &&
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ERR_PICKER_FILE_COUNT'
    ) {
      throw new Error(maxFilesMessage, { cause: error });
    }
    throw error;
  });
  try {
    return await consume(result);
  } finally {
    if (!result.canceled) {
      for (const asset of result.assets ?? []) {
        try {
          const pickerDirectory = new Directory(Paths.cache, 'DocumentPicker');
          const prefix = `${pickerDirectory.uri.replace(/\/$/, '')}/`;
          if (!asset.uri.startsWith(prefix)) continue;
          const name = decodeURIComponent(asset.uri.slice(prefix.length));
          if (name.includes('\0') || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.[^/\\]*$/i.test(name)) continue;
          const file = new File(asset.uri);
          if (file.exists) file.delete();
        } catch {
          // The cache cleanup must not replace a confirmed upload or the consumer's error.
        }
      }
    }
  }
}
