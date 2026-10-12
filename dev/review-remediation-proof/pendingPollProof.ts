import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  MAX_COMPOSER_MARKDOWN_LENGTH,
  MAX_COMPOSER_POLL_COUNT,
  nodeSeekPendingPollToken,
  normalizePendingNodeSeekPoll
} from '@/domain/forum/structuredComposer';
import { saveNodeSeekPollJournalEntry } from '@/platform/persistence/nodeSeekPollJournal';
import { materializePendingNodeSeekPolls } from '@/sources/nodeseek/pendingPolls';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function verifyPendingPollMaterialization(
  run: (name: string, task: () => Promise<void>, metrics?: Record<string, unknown>) => Promise<void>
) {
  const metrics = {
    inputChars: MAX_COMPOSER_MARKDOWN_LENGTH,
    pollCount: MAX_COMPOSER_POLL_COUNT,
    splitInputChars: 0,
    sliceOutputChars: 0,
    guards: 0,
    creates: 0,
    operationMs: 0,
    outputVerified: false,
    descriptorsRestored: false
  };
  await run(
    'content-hermes-pending-poll-materialization',
    async () => {
      check('HermesInternal' in globalThis, 'Pending poll proof requires Hermes');
      check(
        (await AsyncStorage.getItem('reader-storage-proof-owner')) === 'isolated',
        'Refusing unowned journal storage'
      );
      // The isolated runner checkpoints composer-journal.db and its WAL/SHM before this fixture writes.
      const identityKey = `nodeseek:review-pending-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const polls = Array.from({ length: MAX_COMPOSER_POLL_COUNT }, (_, index) =>
        normalizePendingNodeSeekPoll({
          localId: `proof_poll_${String(index).padStart(8, '0')}`,
          title: `Question ${index}`,
          options: ['A', 'B'],
          multiple: false,
          isPublic: false
        })
      );
      for (const [index, poll] of polls.entries()) {
        await saveNodeSeekPollJournalEntry(identityKey, {
          localId: poll.localId,
          fingerprint: poll.fingerprint,
          remoteId: String(index + 1)
        });
      }
      const tokens = [...polls]
        .reverse()
        .map((poll) => nodeSeekPendingPollToken(poll.localId))
        .join('\n');
      const controls = 'before\n<img src="/safe.png">\n```text\nordinary code\n```\n';
      const suffix = '\nafter\n';
      const prefix =
        controls +
        'x'.repeat(MAX_COMPOSER_MARKDOWN_LENGTH - controls.length - tokens.length - suffix.length - 1) +
        '\n';
      const content = prefix + tokens + suffix;
      const expected =
        prefix +
        [...polls]
          .reverse()
          .map((_, index) => `nsapp://vote?id=${polls.length - index}`)
          .join('\n') +
        suffix;
      const splitDescriptor = Object.getOwnPropertyDescriptor(String.prototype, 'split');
      const sliceDescriptor = Object.getOwnPropertyDescriptor(String.prototype, 'slice');
      check(splitDescriptor?.value && sliceDescriptor?.value, 'Missing native string methods');
      const split = String.prototype.split;
      const slice = String.prototype.slice;
      const budget = content.length * 6 + 10_000;
      const withinBudget = () =>
        check(
          metrics.splitInputChars + metrics.sliceOutputChars <= budget,
          'Pending poll body was repeatedly scanned/copied'
        );
      // eslint-disable-next-line no-extend-native -- Observe the native method; restore its exact descriptor in finally.
      Object.defineProperty(String.prototype, 'split', {
        ...splitDescriptor,
        value(this: string, ...args: Parameters<typeof split>) {
          metrics.splitInputChars += this.length;
          withinBudget();
          return Reflect.apply(split, this, args);
        }
      });
      // eslint-disable-next-line no-extend-native -- Count copied output so relocating repeated work into slice cannot pass.
      Object.defineProperty(String.prototype, 'slice', {
        ...sliceDescriptor,
        value(this: string, ...args: Parameters<typeof slice>) {
          const result = Reflect.apply(slice, this, args);
          metrics.sliceOutputChars += result.length;
          withinBudget();
          return result;
        }
      });
      const started = performance.now();
      let output: string;
      try {
        output = await materializePendingNodeSeekPolls({
          content,
          polls,
          identityKey,
          assertCurrent() {
            metrics.guards++;
            check(identityKey.startsWith('nodeseek:review-pending-'), 'Fixture identity changed');
          },
          confirmReplacement: async () => {
            throw new Error('Known poll requested replacement confirmation');
          },
          createPoll: async () => {
            metrics.creates++;
            throw new Error('Remote creation denied by isolated proof');
          },
          notify: (message) => {
            throw new Error(message);
          }
        });
      } finally {
        metrics.operationMs = performance.now() - started;
        // eslint-disable-next-line no-extend-native -- Restore even if a guard, database read or work budget fails.
        Object.defineProperty(String.prototype, 'split', splitDescriptor);
        // eslint-disable-next-line no-extend-native -- Restore the exact native slice descriptor.
        Object.defineProperty(String.prototype, 'slice', sliceDescriptor);
        metrics.descriptorsRestored =
          Object.getOwnPropertyDescriptor(String.prototype, 'split')?.value === split &&
          Object.getOwnPropertyDescriptor(String.prototype, 'slice')?.value === slice;
      }
      check(output === expected, 'Materialization changed ordinary body, code, media or marker order');
      check(output.endsWith('nsapp://vote?id=1\nafter\n'), 'Last marker or trailing body changed');
      check((output.match(/nsapp:\/\/vote\?id=\d+/g) || []).length === polls.length, 'Remote marker count changed');
      check(!output.includes('<!-- wz:nodeseek-poll:'), 'A local pending token survived');
      check(
        metrics.creates === 0 && metrics.guards === polls.length * 5,
        'Known-poll identity guards or no-create path changed'
      );
      check(metrics.descriptorsRestored, 'Native string descriptors were not restored');
      metrics.outputVerified = true;
    },
    metrics
  );
}
