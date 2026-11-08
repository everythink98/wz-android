import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type FileUriPart = string | { uri: string };

export function fileUriFor(parts: FileUriPart[]) {
  const [root, ...names] = parts.map((part) => (typeof part === 'string' ? part : part.uri));
  return pathToFileURL(join(fileURLToPath(root), ...names)).href;
}
