import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hasText = (value) => typeof value === 'string' && Boolean(value.trim());
const textList = (value) => Array.isArray(value) && value.every(hasText);

export function stateModelReviewIssues(rows, expected, root = process.cwd()) {
  const issues = [];
  const remaining = new Map(expected.map((row) => [row.id, row.owner]));
  const kinds = new Set(['workflow', 'explicit', 'data-resource', 'redundant', 'unproven']);
  const actions = new Set(['refactor', 'keep', 'derive', 'delete', 'investigate']);
  const isRepositoryFile = (reference) => {
    if (!hasText(reference) || path.isAbsolute(reference)) return false;
    const relative = path.relative(root, path.resolve(root, reference));
    return !relative.startsWith('..') && statSync(path.join(root, relative), { throwIfNoEntry: false })?.isFile();
  };
  for (const row of rows) {
    if (!remaining.has(row.id)) issues.push(`${row.id}: duplicate or outside baseline`);
    else if (row.owner !== remaining.get(row.id)) issues.push(`${row.id}: owner differs from baseline`);
    remaining.delete(row.id);
    if (!kinds.has(row.kind) || !actions.has(row.action)) issues.push(`${row.id}: invalid classification`);
    if (!Number.isInteger(row.batch) || row.batch < 1 || row.batch > 10) issues.push(`${row.id}: invalid batch`);
    for (const key of ['invariant', 'consumer', 'cannotDerive']) {
      if (!hasText(row[key])) issues.push(`${row.id}: missing ${key}`);
    }
    const checkTests = (tests) => {
      if (!textList(tests)) issues.push(`${row.id}: invalid test references`);
      else for (const test of tests) if (!isRepositoryFile(test)) issues.push(`${row.id}: missing test file ${test}`);
    };
    checkTests(row.tests);
    if (typeof row.evidenceGap !== 'string' || (!row.tests?.length && !row.evidenceGap?.trim()))
      issues.push(`${row.id}: missing evidence gap`);
    if (row.kind === 'unproven' && row.action !== 'investigate') issues.push(`${row.id}: unproven must stay open`);
    if (row.kind === 'unproven' && !row.evidenceGap?.trim()) issues.push(`${row.id}: unproven needs a specific gap`);
    const implementation = row.implementation;
    const changesModel = ['refactor', 'derive', 'delete'].includes(row.action);
    if (implementation === undefined) {
      if (changesModel) issues.push(`${row.id}: missing implementation`);
      continue;
    }
    if (!implementation || typeof implementation !== 'object' || Array.isArray(implementation)) {
      issues.push(`${row.id}: invalid implementation`);
      continue;
    }
    const { outcome, residualControlAuthority: residual } = implementation;
    if (!['whole', 'partial', 'keep'].includes(outcome)) issues.push(`${row.id}: invalid implementation outcome`);
    else if ((outcome === 'keep' && row.action !== 'keep') || (outcome !== 'keep' && !changesModel))
      issues.push(`${row.id}: implementation outcome differs from action`);
    if (!/^B(?:0[1-9]|10)$/.test(implementation.batch)) issues.push(`${row.id}: invalid implementation batch`);
    if (!hasText(implementation.delivered)) issues.push(`${row.id}: missing implementation delivered`);
    if (residual !== undefined || outcome !== 'keep') {
      if (!textList(residual)) issues.push(`${row.id}: invalid residual control references`);
      else {
        if (outcome === 'whole' && residual.length) issues.push(`${row.id}: whole has residual control`);
        if (outcome === 'partial' && !residual.length) issues.push(`${row.id}: partial needs residual control`);
      }
    }
    if (implementation.primaryTests !== undefined) checkTests(implementation.primaryTests);
    const validation = /^([^#]+\.md)#(b(?:0[1-9]|10))$/.exec(implementation.validation || '');
    if (
      !validation ||
      !isRepositoryFile(validation[1]) ||
      !new RegExp(`^##[\\t ]+${validation[2]}[\\t ]*$`, 'im').test(readFileSync(path.join(root, validation[1]), 'utf8'))
    )
      issues.push(`${row.id}: invalid validation reference ${implementation.validation}`);
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
  const issues = stateModelReviewIssues(review.rows, expected, root);
  if (expected.length !== 281) issues.push('Original retained baseline must remain 281');
  if (review.baseline !== 'beff077fe712814b8d255ce1585a98c94698fce1') issues.push('Review baseline changed');
  if (issues.length) throw new Error(issues.join('\n'));
  return review.rows.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`State model review passed (${checkStateModelReview()} models).`);
}
