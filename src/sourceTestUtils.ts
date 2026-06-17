import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Source readers are for coarse architecture boundary tests only.
 * Prefer behavior tests for parsing, state, and user-facing rules; use these
 * helpers when a public API cannot prove an import or ownership boundary.
 */
export function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8').replace(/\r\n/g, '\n');
}

export function readOptionalProjectFile(...segments: string[]) {
  const filePath = join(process.cwd(), ...segments);
  return existsSync(filePath) ? readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n') : '';
}
