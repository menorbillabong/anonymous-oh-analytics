import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { publicationIsWithinPeriod } from '../lib/tracking-period.ts';
import { postDateKey } from '../lib/post-date.ts';
import { xPostDateKey } from '../lib/x-timeline.ts';
import { xStatusId } from '../lib/x-post-dedupe.ts';
import { planSheetUpdates } from '../lib/google-sheets-plan.ts';

// Timestamps returned by the same metadata source used by the application.
const originals = [
  ['2101141694125084688', '2026-09-19T02:49:51Z'],
  ['2101141469360701507', '2026-09-19T02:48:58Z'],
  ['2101141241412940282', '2026-09-19T02:48:03Z'],
  ['2101140956842017044', '2026-09-19T02:46:56Z'],
  ['2101140735005184154', '2026-09-19T02:46:03Z'],
].map(([id, timestamp]) => Object.freeze({
  post_url: `https://x.com/Adrianoramalhoo/status/${id}/photo/1`,
  published_date: '2026-09-19',
  published_at: '2026-09-19',
  x_published_at: timestamp,
}));
const start = '2026-09-01';
const today = postDateKey('2026-09-19T02:55:00Z');

test('accepts all five reported posts on September 18 in Brasilia without rewriting dates', () => {
  assert.equal(today, '2026-09-18');
  const before = JSON.stringify(originals);
  for (const post of originals) {
    assert.equal(post.published_date <= today, false, 'reproduces the old UTC-date rejection');
    assert.equal(publicationIsWithinPeriod(post, start, today), true);
    assert.equal(publicationIsWithinPeriod(post, '2026-09-19', '2026-09-20'), false);
    assert.equal(xPostDateKey(post.x_published_at), '2026-09-18');
  }
  assert.equal(JSON.stringify(originals), before);
});

test('includes complete boundary days and excludes neighboring days at month/year rollover', () => {
  for (const [timestamp, from, to, expected] of [
    ['2026-09-01T02:59:59Z', '2026-09-01', '2026-09-30', false],
    ['2026-09-01T03:00:00Z', '2026-09-01', '2026-09-30', true],
    ['2026-10-01T02:59:59Z', '2026-09-01', '2026-09-30', true],
    ['2026-10-01T03:00:00Z', '2026-09-01', '2026-09-30', false],
    ['2027-01-01T02:59:59Z', '2026-12-01', '2026-12-31', true],
    ['2027-01-01T03:00:00Z', '2026-12-01', '2026-12-31', false],
    ['2026-09-18T23:49:51-03:00', start, today, true],
  ] as const) {
    const post = { x_published_at: timestamp, published_at: timestamp.slice(0, 10) };
    assert.equal(publicationIsWithinPeriod(post, from, to), expected, timestamp);
    const serverDate = xPostDateKey(timestamp);
    assert.equal(Boolean(serverDate && serverDate >= from && serverDate <= to), expected);
  }
});

test('keeps date-only fallback stable and rejects missing/invalid dates or missing period', () => {
  for (const post of [{ published_date: today }, { published_at: today, x_published_at: null }]) {
    assert.equal(publicationIsWithinPeriod(post, start, today), true);
  }
  assert.equal(publicationIsWithinPeriod({}, start, today), false);
  assert.equal(publicationIsWithinPeriod({ x_published_at: 'invalid' }, start, today), false);
  assert.equal(publicationIsWithinPeriod(originals[0], '', today), false);
  assert.equal(publicationIsWithinPeriod(originals[0], start, ''), false);
});

// Execute the actual filter predicates from the components so preview and save
// cannot silently regress to different date rules. No database writes occur.
function sourceFile(path: string) {
  const text = readFileSync(new URL(path, import.meta.url), 'utf8');
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function findNode(file: ts.SourceFile, predicate: (node: ts.Node) => boolean) {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (!found && predicate(node)) found = node;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(found, 'expected ingestion guard exists');
  return found;
}

test('bulk preview, X review save, and dashboard fallback accept the five original records', () => {
  for (const [path, variable] of [
    ['../app/bulk-review-injector.tsx', 'inPeriod'],
    ['../app/bulk-review-injector.tsx', 'uniqueRows'],
    ['../app/dashboard.tsx', 'periodRows'],
  ]) {
    const file = sourceFile(path);
    const declaration = findNode(file, node => ts.isVariableDeclaration(node) && node.name.getText(file) === variable) as ts.VariableDeclaration;
    const filter = declaration.initializer as ts.CallExpression;
    const callback = filter.arguments[0].getText(file);
    const evaluate = new Function('publicationIsWithinPeriod', 'periodStart', 'activePeriod', 'today', 'existingIds', 'xStatusId', `return (${callback});`);
    const predicate = evaluate(publicationIsWithinPeriod, start, { start_date: start }, today, new Set(), xStatusId);
    assert.equal(originals.filter(predicate).length, 5, variable);
    assert.equal(predicate({ ...originals[0], x_published_at: '2026-08-31T23:00:00-03:00' }), false);
    if (variable === 'uniqueRows') {
      const rejectDuplicate = evaluate(publicationIsWithinPeriod, start, { start_date: start }, today, new Set([xStatusId(originals[0].post_url)]), xStatusId);
      assert.equal(originals.filter(rejectDuplicate).length, 4, 'duplicate protection remains active');
    }
  }
});

test('single-publication guard uses the full X timestamp, including its upper boundary', () => {
  const file = sourceFile('../app/dashboard.tsx');
  const call = findNode(file, node => ts.isCallExpression(node)
    && node.expression.getText(file) === 'publicationIsWithinPeriod'
    && node.arguments[0].getText(file).includes('...form'));
  const evaluate = new Function('publicationIsWithinPeriod', 'form', 'activePeriod', 'today', `return ${call.getText(file)};`);
  for (const form of originals) assert.equal(evaluate(publicationIsWithinPeriod, form, { start_date: start }, today), true);
  assert.equal(evaluate(publicationIsWithinPeriod, { ...originals[0], x_published_at: '2026-09-19T03:00:00Z' }, { start_date: start }, today), false);
});

test('eligibility filtering leaves the existing Sheets plan and publication dates unchanged', () => {
  const rows: unknown[][] = Array.from({ length: 140 }, () => []);
  rows[2] = ['', 'Settlement Month', '2026-09'];
  rows[100] = ['', 'Month', 'Publish Date', 'Platform', 'Content Link', 'Impressions / Views', 'Likes', 'Eligible', '', '', 'Month', 'Publish Date', 'Platform', 'Content Link', 'Impressions / Views', 'Likes', 'Eligible', 'Reward', 'Theme'];
  const before = planSheetUpdates('TEST', rows, originals, '2026-09');
  const eligible = originals.filter(post => publicationIsWithinPeriod(post, start, today));
  const after = planSheetUpdates('TEST', rows, eligible, '2026-09');
  assert.equal(after.normalCount, 5);
  assert.deepEqual(after, before);
});
