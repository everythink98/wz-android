import { describe, expect, it } from 'vitest';
import { checkStateModelReview, stateModelReviewIssues } from '../../scripts/check-state-model-review.mjs';

const reviewed = {
  id: 'one',
  owner: 'one.ts',
  kind: 'workflow',
  action: 'refactor',
  batch: 3,
  invariant: 'Only the current request can publish.',
  consumer: 'request completion',
  cannotDerive: 'A URL does not identify the current request.',
  tests: ['tests/tooling/state-model-review.test.ts'],
  evidenceGap: '',
  implementation: {
    batch: 'B03',
    outcome: 'whole',
    delivered: 'The queue owns cancellation and completion.',
    residualControlAuthority: [],
    validation: 'docs/state-model-refactor.md#b03'
  }
};
const expected = [{ id: reviewed.id, owner: reviewed.owner }];

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

  it('keeps unimplemented reviews open and allows later acceptance of an earlier implementation', () => {
    for (const [kind, action] of [
      ['explicit', 'keep'],
      ['unproven', 'investigate']
    ]) {
      expect(
        stateModelReviewIssues(
          [{ ...reviewed, kind, action, evidenceGap: 'Device cancellation is unverified.', implementation: undefined }],
          expected
        )
      ).toEqual([]);
    }
    expect(
      stateModelReviewIssues(
        [{ ...reviewed, implementation: { ...reviewed.implementation, batch: 'B01', reviewedIn: 'B03' } }],
        expected
      )
    ).toEqual([]);
    expect(
      stateModelReviewIssues(
        [
          {
            ...reviewed,
            kind: 'explicit',
            action: 'keep',
            implementation: { ...reviewed.implementation, outcome: 'keep', residualControlAuthority: undefined }
          }
        ],
        expected
      )
    ).toEqual([]);
  });

  it.each([
    [undefined, 'missing implementation'],
    [null, 'invalid implementation'],
    [{ ...reviewed.implementation, outcome: 'finished' }, 'invalid implementation outcome'],
    [{ ...reviewed.implementation, outcome: 'keep' }, 'implementation outcome differs from action'],
    [{ ...reviewed.implementation, batch: 'B11' }, 'invalid implementation batch'],
    [{ ...reviewed.implementation, delivered: '' }, 'missing implementation delivered'],
    [
      { ...reviewed.implementation, residualControlAuthority: ['caller still owns cancellation'] },
      'whole has residual control'
    ],
    [{ ...reviewed.implementation, outcome: 'partial' }, 'partial needs residual control'],
    [{ ...reviewed.implementation, residualControlAuthority: [''] }, 'invalid residual control references']
  ])('rejects inconsistent implementation credit %#', (implementation, message) => {
    expect(stateModelReviewIssues([{ ...reviewed, implementation }], expected)).toContain(`one: ${message}`);
  });

  it('rejects broken evidence paths and validation anchors', () => {
    expect(stateModelReviewIssues([{ ...reviewed, tests: ['tests/missing-state-model.test.ts'] }], expected)).toContain(
      'one: missing test file tests/missing-state-model.test.ts'
    );
    expect(
      stateModelReviewIssues(
        [{ ...reviewed, implementation: { ...reviewed.implementation, primaryTests: ['tests'] } }],
        expected
      )
    ).toContain('one: missing test file tests');
    for (const validation of ['docs/missing-state-model.md#b03', 'docs/state-model-refactor.md#b11']) {
      expect(
        stateModelReviewIssues([{ ...reviewed, implementation: { ...reviewed.implementation, validation } }], expected)
      ).toContain(`one: invalid validation reference ${validation}`);
    }
  });
});
