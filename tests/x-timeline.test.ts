import assert from 'node:assert/strict';
import test from 'node:test';
import { extractTimelineData, postsWithinDateRange, timelineCursorFromFxData, timelinePostsFromData, timelinePostsFromFxData, xPostDateKey } from '../lib/x-timeline.ts';

const entries = [
  { content: { tweet: { id_str: '101', conversation_id_str: '101', full_text: 'Post original', created_at: '2026-09-14T12:00:00Z', favorite_count: 4, retweet_count: 2, reply_count: 1, user: { screen_name: 'Creator', name: 'Criadora', profile_image_url_https: 'https://img.test/avatar.jpg' } } } },
  { content: { tweet: { id_str: '102', conversation_id_str: '101', full_text: '@alguem resposta', user: { screen_name: 'Creator' } } } },
  { content: { tweet: { id_str: '103', conversation_id_str: '103', full_text: 'RT @alguem repost', user: { screen_name: 'Creator' } } } },
  { content: { tweet: { id_str: '104', conversation_id_str: '104', full_text: 'Outro autor', user: { screen_name: 'Other' } } } },
];

test('extracts the embedded timeline JSON', () => {
  const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { timeline: { entries } } } })}</script></html>`;
  assert.equal(extractTimelineData(html).props.pageProps.timeline.entries.length, 4);
});

test('keeps only original posts from the requested handle', () => {
  const posts = timelinePostsFromData({ props: { pageProps: { timeline: { entries } } } }, '@creator');
  assert.deepEqual(posts.map(post => post.id), ['101']);
  assert.equal(posts[0].url, 'https://x.com/Creator/status/101');
  assert.equal(posts[0].likes, 4);
});

test('maps the free timeline response and excludes replies and reposts', () => {
  const sharedAuthor = { screen_name: 'Creator', name: 'Criadora', avatar_url: 'https://img.test/avatar.jpg' };
  const payload = { results: [
    { type: 'status', id: '201', text: 'Original com mídia', created_at: 'Sun Sep 14 12:00:00 +0000 2026', views: 90, likes: 8, reposts: 3, replies: 2, replying_to: null, reposted_by: null, author: sharedAuthor, media: { photos: [{ url: 'https://img.test/post.jpg' }], videos: [{ thumbnail_url: 'https://img.test/video.jpg', formats: [{ container: 'mp4', bitrate: 256000, url: 'https://video.test/low.mp4' }, { container: 'mp4', bitrate: 832000, url: 'https://video.test/high.mp4' }] }] } },
    { type: 'status', id: '202', text: 'Resposta', replying_to: { id: '100' }, reposted_by: null, author: sharedAuthor },
    { type: 'status', id: '203', text: 'Repost', replying_to: null, reposted_by: { screen_name: 'Creator' }, author: { screen_name: 'Other' } },
    { type: 'status', id: '204', text: 'Outro autor', replying_to: null, reposted_by: null, author: { screen_name: 'Other' } },
  ] };
  const posts = timelinePostsFromFxData(payload, '@creator');
  assert.deepEqual(posts.map(post => post.id), ['201']);
  assert.equal(posts[0].views, 90);
  assert.deepEqual(posts[0].image_urls, ['https://img.test/post.jpg']);
  assert.equal(posts[0].video_url, 'https://video.test/high.mp4');
});

test('reads the bottom cursor used to paginate the public timeline', () => {
  assert.equal(timelineCursorFromFxData({ cursor: { bottom: 'next-page' } }), 'next-page');
  assert.equal(timelineCursorFromFxData({ cursor: { bottom: null } }), null);
});

test('filters imported posts to the open period in Sao Paulo time', () => {
  const base = { id: '1', url: 'https://x.com/a/status/1', text: 'a', likes: 0, reposts: 0, comments: 0, author_handle: 'a', author_name: 'A', author_avatar: '' };
  const posts = [
    { ...base, id: '1', published_at: '2026-08-31T23:30:00-03:00' },
    { ...base, id: '2', published_at: '2026-09-01T00:30:00-03:00' },
    { ...base, id: '3', published_at: '2026-09-15T23:59:00-03:00' },
  ];
  assert.equal(xPostDateKey(posts[1].published_at), '2026-09-01');
  assert.deepEqual(postsWithinDateRange(posts, '2026-09-01', '2026-09-15').map(post => post.id), ['2', '3']);
});

