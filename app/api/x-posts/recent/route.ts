import { NextResponse } from 'next/server';
import { pinnedStatusIdFromProfileHtml, postsWithinDateRange, timelinePostsFromFxData, xPostDateKey, type XTimelinePost } from '@/lib/x-timeline';
import { fetchPublicTimeline, X_PARTIAL_WARNING } from '@/lib/x-timeline-fetch';

export const maxDuration = 60;
const FX_STATUS_URL = 'https://api.fxtwitter.com/2/status';
const X_PROFILE_URL = 'https://x.com';

function bearerToken(request: Request) {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

async function claimImport(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('CONFIGURATION_ERROR');
  const response = await fetch(`${url}/rest/v1/rpc/claim_my_x_import_request`, {
    method: 'POST',
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
    headers: {
      apikey: key,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: '{}',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(payload?.message || payload?.error || 'X_IMPORT_NOT_ALLOWED');
    if (message.includes('X_IMPORT_RATE_LIMIT')) throw new Error('X_IMPORT_RATE_LIMIT');
    if (message.includes('X_IMPORT_HANDLE_REQUIRED')) throw new Error('X_IMPORT_HANDLE_REQUIRED');
    if (message.includes('X_IMPORT_PERIOD_REQUIRED')) throw new Error('X_IMPORT_PERIOD_REQUIRED');
    throw new Error('X_IMPORT_NOT_ALLOWED');
  }
  return payload as { handle?: string; limit?: number; start_date?: string };
}

async function fetchPinnedPost(handle: string) {
  const profileController = new AbortController();
  const profileTimeout = setTimeout(() => profileController.abort(), 9_000);
  try {
    const profileResponse = await fetch(`${X_PROFILE_URL}/${encodeURIComponent(handle)}`, {
      cache: 'no-store',
      signal: profileController.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': 'Mozilla/5.0 (compatible; AnonymousOHAnalytics/2.0)',
      },
    });
    if (!profileResponse.ok) return null;
    const html = await profileResponse.text();
    if (html.length > 5_000_000) return null;
    const pinnedId = pinnedStatusIdFromProfileHtml(html, handle);
    if (!pinnedId) return null;

    const statusController = new AbortController();
    const statusTimeout = setTimeout(() => statusController.abort(), 9_000);
    try {
      const statusResponse = await fetch(`${FX_STATUS_URL}/${pinnedId}`, {
        cache: 'no-store',
        signal: statusController.signal,
        headers: {
          accept: 'application/json',
          'user-agent': 'AnonymousOHAnalytics/2.0 (public X post importer)',
        },
      });
      if (!statusResponse.ok) return null;
      const body = await statusResponse.text();
      if (body.length > 5_000_000) return null;
      const payload = JSON.parse(body);
      return timelinePostsFromFxData({ results: [payload?.status] }, handle, 1)[0] || null;
    } finally {
      clearTimeout(statusTimeout);
    }
  } catch {
    return null;
  } finally {
    clearTimeout(profileTimeout);
  }
}

function mergeTimelineWithPinnedPost(timeline: XTimelinePost[], pinned: XTimelinePost | null, startDate: string, endDate: string, limit: number) {
  const collected = new Map(timeline.map(post => [post.id, post]));
  if (pinned) collected.set(pinned.id, pinned);
  return postsWithinDateRange([...collected.values()], startDate, endDate)
    .sort((left, right) => String(right.published_at || '').localeCompare(String(left.published_at || '')))
    .slice(0, limit);
}

function mediaUrl(value: any) {
  return typeof value === 'string' ? value : typeof value?.url === 'string' ? value.url : null;
}

function bestVideo(media: any) {
  const videos = Array.isArray(media?.videos) ? media.videos : [];
  if (!videos.length) return { video_url: null, thumbnail_url: null };
  const video = videos[0];
  const formats = Array.isArray(video.formats) ? video.formats.filter((item: any) => /^https?:/i.test(item?.url || '')) : [];
  formats.sort((a: any, b: any) => Number(b.bitrate || 0) - Number(a.bitrate || 0));
  return {
    video_url: formats[0]?.url || video.url || null,
    thumbnail_url: mediaUrl(video.thumbnail_url) || mediaUrl(video.thumbnail) || mediaUrl(video.poster_url) || mediaUrl(video.poster) || null,
  };
}

async function enrichPost(post: XTimelinePost) {
  try {
    const response = await fetch(`https://api.fxtwitter.com/${encodeURIComponent(post.author_handle)}/status/${post.id}`, { cache: 'no-store', signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return post;
    const payload = await response.json();
    const tweet = payload?.tweet || payload?.status;
    if (!tweet) return post;
    const video = bestVideo(tweet.media);
    return {
      ...post,
      text: String(tweet.text || post.text).trim() || post.text,
      published_at: tweet.created_at ? new Date(tweet.created_at).toISOString() : post.published_at,
      views: Math.max(0, Number(tweet.views || 0)),
      likes: Math.max(0, Number(tweet.likes || post.likes || 0)),
      reposts: Math.max(0, Number(tweet.retweets ?? tweet.reposts ?? post.reposts ?? 0)),
      comments: Math.max(0, Number(tweet.replies ?? post.comments ?? 0)),
      image_urls: (tweet.media?.photos || []).map((item: any) => item?.url).filter(Boolean),
      video_url: video.video_url,
      thumbnail_url: video.thumbnail_url,
      author_handle: String(tweet.author?.screen_name || post.author_handle),
      author_name: String(tweet.author?.name || tweet.author?.display_name || post.author_name),
      author_avatar: String(tweet.author?.avatar_url || tweet.author?.avatar || tweet.author?.profile_image_url || post.author_avatar),
    };
  } catch {
    return post;
  }
}

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
  try {
    const access = await claimImport(token);
    const handle = String(access.handle || '').replace(/^@/, '');
    const limit = Math.max(1, Math.min(100, Number(access.limit || 100)));
    const startDate = String(access.start_date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('X_IMPORT_PERIOD_REQUIRED');
    const endDate = xPostDateKey(new Date().toISOString());
    const [timeline, pinned] = await Promise.all([
      fetchPublicTimeline(handle, limit, startDate, endDate),
      fetchPinnedPost(handle),
    ]);
    const mergedTimeline = mergeTimelineWithPinnedPost(timeline.posts, pinned, startDate, endDate, limit);
    const posts = await Promise.all(mergedTimeline.map(post => post.views === undefined ? enrichPost(post) : post));
    return NextResponse.json({ handle, period_start: startDate, period_end: endDate, posts, partial: timeline.partial, warning: timeline.partial ? X_PARTIAL_WARNING : null }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'X_TIMELINE_UNAVAILABLE';
    if (code === 'X_IMPORT_RATE_LIMIT') return NextResponse.json({ error: 'Aguarde alguns segundos antes de buscar novamente.' }, { status: 429 });
    if (code === 'X_IMPORT_HANDLE_REQUIRED') return NextResponse.json({ error: 'Cadastre seu @ do X nas Configurações antes de buscar.' }, { status: 400 });
    if (code === 'X_IMPORT_PERIOD_REQUIRED') return NextResponse.json({ error: 'Abra um período no Painel antes de buscar publicações no X.' }, { status: 409 });
    if (code === 'X_IMPORT_NOT_ALLOWED') return NextResponse.json({ error: 'A busca automática não está liberada para esta conta.' }, { status: 403 });
    if (code === 'CONFIGURATION_ERROR') return NextResponse.json({ error: 'A busca automática não está configurada.' }, { status: 500 });
    console.warn('[x-import:failed]', { reason: ['X_TIMELINE_RATE_LIMITED', 'X_TIMELINE_UNAVAILABLE'].includes(code) ? code : 'unexpected' });
    if (code === 'X_TIMELINE_RATE_LIMITED') return NextResponse.json({ error: 'O serviço de consulta do X está limitando as buscas agora. Aguarde um pouco e tente novamente, ou use a adição manual.' }, { status: 503 });
    return NextResponse.json({ error: 'O X não liberou a lista pública agora. Tente novamente depois ou use a adição manual.' }, { status: 503 });
  }
}

