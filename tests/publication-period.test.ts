import assert from 'node:assert/strict';
import test from 'node:test';
import { isActiveCountingPost, postsForPublicationPeriod } from '../lib/publication-period.ts';

const posts = [
  { id: 'active-default' },
  { id: 'active-explicit', counting_excluded: false },
  { id: 'previous', counting_excluded: true },
];

test('keeps new and active publications in the current period', () => {
  assert.equal(isActiveCountingPost(posts[0]), true);
  assert.deepEqual(postsForPublicationPeriod(posts, 'current').map((post) => post.id), [
    'active-default',
    'active-explicit',
  ]);
});

test('shows only excluded publications in the previous period', () => {
  assert.deepEqual(postsForPublicationPeriod(posts, 'previous').map((post) => post.id), [
    'previous',
  ]);
});
