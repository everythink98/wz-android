import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

export function readOptionalProjectFile(...segments: string[]) {
  const filePath = join(process.cwd(), ...segments);
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}
