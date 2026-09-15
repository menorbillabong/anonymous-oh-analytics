import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPeriodStart, oldestActivePostDate, postIsWithinPeriod } from '../lib/tracking-period.ts';

test('defaults a new period to the first day of the current month', () => {
  assert.equal(defaultPeriodStart('2026-09-15'), '2026-09-01');
});

test('finds the oldest post that still participates in current totals', () => {
  const posts = [
    { published_at: '2026-09-04', counting_excluded: false },
    { x_published_at: '2026-08-14T12:00:00Z', counting_excluded: false },
    { published_at: '2026-07-01', counting_excluded: true },
  ];
  assert.equal(oldestActivePostDate(posts), '2026-08-14');
});

test('checks whether a post belongs to an explicit period', () => {
  assert.equal(postIsWithinPeriod('2026-09-01', '2026-09-01', '2026-09-15'), true);
  assert.equal(postIsWithinPeriod('2026-08-31', '2026-09-01', '2026-09-15'), false);
});
