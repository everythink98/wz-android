import { describe, expect, it } from 'vitest';
import { checkStateModelReview, stateModelReviewIssues } from '../../scripts/check-state-model-review.mjs';

describe('retained model review', () => {
  it('accounts for every original retained scope', () => {
    expect(checkStateModelReview()).toBe(281);
  });

  it('rejects duplicate scopes, omitted scopes and unsupported keep conclusions', () => {
    const row = {
      id: 'one',
      owner: 'one.ts',
      kind: 'unproven',
      action: 'keep',
      batch: 2,
      invariant: '',
      consumer: '',
      cannotDerive: '',
      tests: [],
      evidenceGap: ''
    };
    const issues = stateModelReviewIssues(
      [row, row],
      [
        { id: 'one', owner: 'one.ts' },
        { id: 'two', owner: 'two.ts' }
      ]
    );
    expect(issues).toContain('one: duplicate or outside baseline');
    expect(issues).toContain('two: missing review');
    expect(issues).toContain('one: missing consumer');
    expect(issues).toContain('one: missing evidence gap');
    expect(issues).toContain('one: unproven must stay open');
    expect(
      stateModelReviewIssues(
        [{ ...row, action: 'investigate', tests: ['one.test.ts'] }],
        [{ id: 'one', owner: 'one.ts' }]
      )
    ).toContain('one: unproven needs a specific gap');
  });
});
