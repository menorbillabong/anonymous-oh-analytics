export type XTimelinePost = {
  id: string;
  url: string;
  text: string;
  published_at: string | null;
  likes: number;
  reposts: number;
  comments: number;
  views?: number;
  image_urls?: string[];
  video_url?: string | null;
  thumbnail_url?: string | null;
  author_handle: string;
  author_name: string;
  author_avatar: string;
};

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? value as Record<string, any> : {};
}

export function extractTimelineData(html: string) {
  const marker = '<script id="__NEXT_DATA__" type="application/json">';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('X_TIMELINE_UNAVAILABLE');
  const jsonStart = start + marker.length;
  const end = html.indexOf('</script>', jsonStart);
  if (end < 0) throw new Error('X_TIMELINE_UNAVAILABLE');
  return JSON.parse(html.slice(jsonStart, end));
}

export function timelinePostsFromData(data: unknown, expectedHandle: string, limit = 12): XTimelinePost[] {
  const root = asRecord(data);
  const entries = root?.props?.pageProps?.timeline?.entries;
  if (!Array.isArray(entries)) return [];
  const normalizedHandle = expectedHandle.replace(/^@/, '').toLowerCase();
  const seen = new Set<string>();
  const posts: XTimelinePost[] = [];

  for (const entry of entries) {
    const tweet = asRecord(asRecord(entry).content?.tweet);
    const user = asRecord(tweet.user);
    const id = String(tweet.id_str || '');
    const authorHandle = String(user.screen_name || expectedHandle).replace(/^@/, '');
    const conversationId = String(tweet.conversation_id_str || id);
    const text = String(tweet.full_text || tweet.text || '').trim();
    const isReply = Boolean(tweet.in_reply_to_status_id_str) || (conversationId && conversationId !== id);
    const isRepost = Boolean(tweet.retweeted_status) || /^RT\s+@/i.test(text);

    if (!/^\d+$/.test(id) || seen.has(id) || !text || isReply || isRepost) continue;
    if (authorHandle.toLowerCase() !== normalizedHandle) continue;
    seen.add(id);

    const created = tweet.created_at ? new Date(tweet.created_at) : null;
    posts.push({
      id,
      url: `https://x.com/${encodeURIComponent(authorHandle)}/status/${id}`,
      text,
      published_at: created && !Number.isNaN(created.getTime()) ? created.toISOString() : null,
      likes: Math.max(0, Number(tweet.favorite_count || 0)),
      reposts: Math.max(0, Number(tweet.retweet_count || 0)),
      comments: Math.max(0, Number(tweet.reply_count || 0)),
      author_handle: authorHandle,
      author_name: String(user.name || authorHandle),
      author_avatar: String(user.profile_image_url_https || ''),
    });
    if (posts.length >= Math.max(1, Math.min(20, limit))) break;
  }
  return posts;
}

function bestFxVideo(media: Record<string, any>) {
  const videos = Array.isArray(media.videos) ? media.videos : [];
  if (!videos.length) return { video_url: null, thumbnail_url: null };
  const video = asRecord(videos[0]);
  const formats = Array.isArray(video.formats)
    ? video.formats.filter((item: any) => item?.container === 'mp4' && /^https:\/\//i.test(String(item?.url || '')))
    : [];
  formats.sort((a: any, b: any) => Number(b.bitrate || 0) - Number(a.bitrate || 0));
  return {
    video_url: String(formats[0]?.url || (/^https:\/\//i.test(String(video.url || '')) ? video.url : '')) || null,
    thumbnail_url: /^https:\/\//i.test(String(video.thumbnail_url || '')) ? String(video.thumbnail_url) : null,
  };
}

export function timelinePostsFromFxData(data: unknown, expectedHandle: string, limit = 12): XTimelinePost[] {
  const results = asRecord(data).results;
  if (!Array.isArray(results)) return [];
  const normalizedHandle = expectedHandle.replace(/^@/, '').toLowerCase();
  const maximum = Math.max(1, Math.min(100, limit));
  const seen = new Set<string>();
  const posts: XTimelinePost[] = [];

  for (const value of results) {
    const status = asRecord(value);
    const author = asRecord(status.author);
    const media = asRecord(status.media);
    const id = String(status.id || '');
    const authorHandle = String(author.screen_name || '').replace(/^@/, '');
    const text = String(status.text || '').trim();
    const isReply = Boolean(status.replying_to);
    const isRepost = Boolean(status.reposted_by) || /^RT\s+@/i.test(text);

    if (status.type !== 'status' || !/^\d+$/.test(id) || seen.has(id) || !text || isReply || isRepost) continue;
    if (authorHandle.toLowerCase() !== normalizedHandle) continue;
    seen.add(id);

    const created = status.created_at ? new Date(status.created_at) : null;
    const video = bestFxVideo(media);
    posts.push({
      id,
      url: `https://x.com/${encodeURIComponent(authorHandle)}/status/${id}`,
      text,
      published_at: created && !Number.isNaN(created.getTime()) ? created.toISOString() : null,
      views: Math.max(0, Number(status.views || 0)),
      likes: Math.max(0, Number(status.likes || 0)),
      reposts: Math.max(0, Number(status.reposts || 0)),
      comments: Math.max(0, Number(status.replies || 0)),
      image_urls: (Array.isArray(media.photos) ? media.photos : [])
        .map((item: any) => String(item?.url || ''))
        .filter((url: string) => /^https:\/\//i.test(url)),
      video_url: video.video_url,
      thumbnail_url: video.thumbnail_url,
      author_handle: authorHandle,
      author_name: String(author.name || authorHandle),
      author_avatar: /^https:\/\//i.test(String(author.avatar_url || '')) ? String(author.avatar_url) : '',
    });
    if (posts.length >= maximum) break;
  }
  return posts;
}

export function timelineCursorFromFxData(data: unknown) {
  const cursor = asRecord(asRecord(data).cursor);
  return typeof cursor.bottom === 'string' && cursor.bottom ? cursor.bottom : null;
}

export function xPostDateKey(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function postsWithinDateRange(posts: XTimelinePost[], start: string, end: string) {
  return posts.filter(post => {
    const date = xPostDateKey(post.published_at);
    return Boolean(date && date >= start && date <= end);
  });
}

