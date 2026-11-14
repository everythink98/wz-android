import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function stateModelReviewIssues(rows, expected) {
  const issues = [];
  const remaining = new Map(expected.map((row) => [row.id, row.owner]));
  const kinds = new Set(['workflow', 'explicit', 'data-resource', 'redundant', 'unproven']);
  const actions = new Set(['refactor', 'keep', 'derive', 'delete', 'investigate']);
  for (const row of rows) {
    if (!remaining.has(row.id)) issues.push(`${row.id}: duplicate or outside baseline`);
    else if (row.owner !== remaining.get(row.id)) issues.push(`${row.id}: owner differs from baseline`);
    remaining.delete(row.id);
    if (!kinds.has(row.kind) || !actions.has(row.action)) issues.push(`${row.id}: invalid classification`);
    if (!Number.isInteger(row.batch) || row.batch < 1 || row.batch > 10) issues.push(`${row.id}: invalid batch`);
    for (const key of ['invariant', 'consumer', 'cannotDerive']) {
      if (typeof row[key] !== 'string' || !row[key].trim()) issues.push(`${row.id}: missing ${key}`);
    }
    if (!Array.isArray(row.tests) || row.tests.some((test) => typeof test !== 'string' || !test.trim()))
      issues.push(`${row.id}: invalid test references`);
    if (typeof row.evidenceGap !== 'string' || (!row.tests?.length && !row.evidenceGap?.trim()))
      issues.push(`${row.id}: missing evidence gap`);
    if (row.kind === 'unproven' && row.action !== 'investigate') issues.push(`${row.id}: unproven must stay open`);
    if (row.kind === 'unproven' && !row.evidenceGap?.trim()) issues.push(`${row.id}: unproven needs a specific gap`);
  }
  for (const id of remaining.keys()) issues.push(`${id}: missing review`);
  return issues;
}

export function checkStateModelReview(root = process.cwd()) {
  const review = JSON.parse(readFileSync(path.join(root, 'docs/state-model-review.json'), 'utf8'));
  const converted = new Set([
    'PL-PATCH-picker-job-settlement',
    'PL-JS-download-artifact-recovery',
    'ui.account-details'
  ]);
  const expected = readFileSync(path.join(root, 'docs/state-machine-batches.csv'), 'utf8')
    .split(/\r?\n/)
    .flatMap((line) => {
      const row = /^"P\d+","([^"]+)","[^"]+","([^"]+)"/.exec(line);
      return row && !converted.has(row[1]) ? [{ id: row[1], owner: row[2] }] : [];
    });
  const issues = stateModelReviewIssues(review.rows, expected);
  if (expected.length !== 281) issues.push('Original retained baseline must remain 281');
  if (review.baseline !== 'beff077fe712814b8d255ce1585a98c94698fce1') issues.push('Review baseline changed');
  if (issues.length) throw new Error(issues.join('\n'));
  return review.rows.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`State model review passed (${checkStateModelReview()} models).`);
}
