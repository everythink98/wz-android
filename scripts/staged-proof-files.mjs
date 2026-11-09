/**
 * @param {(file: string) => void} remove
 */
export function createStagedProofFiles(remove) {
  /** @type {{ phase: 'staging', files: Set<string> } | { phase: 'releasing', files: ReadonlySet<string> } | { phase: 'released' } | { phase: 'failed', error: unknown, files: string[] }} */
  let lease = { phase: 'staging', files: new Set() };
  return {
    /** @param {string} file */
    register(file) {
      if (lease.phase !== 'staging') throw new Error('Staged proof files are closed');
      lease.files.add(file);
      return file;
    },
    /** @param {{ kind: 'none' } | { kind: 'failed', error: unknown }} failure */
    release(failure = { kind: 'none' }) {
      if (lease.phase === 'released') return;
      if (lease.phase === 'failed') throw lease.error;
      if (lease.phase === 'releasing') throw new Error('Staged proof file release is already running');
      const files = lease.files;
      lease = { phase: 'releasing', files };
      const failures = [];
      for (const file of files) {
        try {
          remove(file);
        } catch (error) {
          failures.push({ file, error });
        }
      }
      if (failures.length === 0) {
        lease = { phase: 'released' };
        return;
      }
      const cleanupError =
        failures.length === 1
          ? failures[0].error
          : new AggregateError(
              failures.map(({ error }) => error),
              'Staged proof file cleanup failed'
            );
      const error =
        failure.kind === 'failed'
          ? new AggregateError([failure.error, cleanupError], 'Replay and staged-file cleanup failed')
          : cleanupError;
      lease = { phase: 'failed', error, files: failures.map(({ file }) => file) };
      throw error;
    },
    unconfirmedFiles() {
      return lease.phase === 'released' ? [] : [...lease.files];
    }
  };
}
