import { describe, expect, it } from 'vitest';
import { replyControlsDraftAfterExternalQuery } from './replyControlsQuery';

describe('reply controls query draft', () => {
  it('does not roll back newer typing when the parent acknowledges the last committed query', () => {
    expect(replyControlsDraftAfterExternalQuery('newer typing', 'committed', 'committed')).toBe('newer typing');
  });

  it('accepts a genuinely external query restored from another topic route', () => {
    expect(replyControlsDraftAfterExternalQuery('local', 'committed', 'restored')).toBe('restored');
  });
});
