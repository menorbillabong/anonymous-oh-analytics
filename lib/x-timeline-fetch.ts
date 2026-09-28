import { extractTimelineData, postsWithinDateRange, timelineCursorFromFxData, timelinePostsFromData, timelinePostsFromFxData, xPostDateKey, type XTimelinePost } from './x-timeline.ts';

export const X_PARTIAL_WARNING = 'Busca incompleta: algumas publicações podem não ter sido carregadas. Você pode revisar as encontradas e buscar novamente depois; as já adicionadas serão ocultadas.';

type Options = {
  fetchImpl?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  budgetMs?: number;
  log?: (event: Record<string, string | number>) => void;
};

class SourceError extends Error {
  status: number;
  retryable: boolean;
  constructor(message: string, status = 0, retryable = false) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

/** Public read-only requests only. Never retry the account's authorization/cooldown claim. */
export async function fetchPublicTimeline(handle: string, limit: number, startDate: string, endDate: string, options: Options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const wait = options.wait || ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const now = options.now || Date.now;
  const deadline = now() + (options.budgetMs ?? 40_000);
  const log = options.log || (event => console.warn('[x-import:source]', event));
  const collected = new Map<string, XTimelinePost>();
  const maximum = Math.max(1, Math.min(100, limit));
  let rateLimited = false;
  const result = (partial: boolean) => {
    const posts = postsWithinDateRange([...collected.values()], startDate, endDate);
    return { posts: posts.slice(0, maximum), partial: partial || posts.length > maximum };
  };

  async function read<T>(url: string, source: string, decode: (body: string) => T, retries = 0): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const remaining = deadline - now();
      if (remaining <= 0) throw new SourceError('budget');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(options.timeoutMs ?? 9_000, remaining));
      let failure: SourceError;
      try {
        const response = await fetchImpl(url, {
          cache: 'no-store', signal: controller.signal,
          headers: {
            accept: source === 'fx' ? 'application/json' : 'text/html,application/xhtml+xml',
            'user-agent': source === 'fx' ? 'AnonymousOHAnalytics/2.0 (public X post importer)' : 'Mozilla/5.0 (compatible; AnonymousOHAnalytics/2.0)',
          },
        });
        if (!response.ok) {
          await response.body?.cancel();
          // Do not retry rate limits or access denials, nor switch identities to evade them.
          throw new SourceError('http', response.status, !response.headers.has('retry-after') && (response.status === 408 || response.status >= 500));
        }
        if (response.status === 204 && source === 'fx') return decode('{"results":[]}');
        const body = await response.text();
        if (body.length > 5_000_000) throw new SourceError('oversized');
        return decode(body);
      } catch (error) {
        failure = error instanceof SourceError ? error : new SourceError(
          controller.signal.aborted ? 'timeout' : error instanceof SyntaxError ? 'invalid-json' : 'network', 0, true,
        );
        if (failure.status === 429) rateLimited = true;
        log({ source, attempt: attempt + 1, reason: failure.message, status: failure.status });
      } finally {
        clearTimeout(timer);
      }
      const delay = 500 * (attempt + 1);
      if (!failure.retryable || attempt >= retries || deadline - now() <= delay) throw failure;
      await wait(delay);
    }
  }

  const since = Math.floor(new Date(`${startDate}T00:00:00-03:00`).getTime() / 1000) - 1;
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  try {
    for (let page = 0; page < 5; page++) {
      const query = cursor ? `count=100&cursor=${encodeURIComponent(cursor)}` : `count=100&since=${since}`;
      const payload = await read(`https://api.fxtwitter.com/2/profile/${encodeURIComponent(handle)}/statuses?${query}`, 'fx', body => {
        const data = JSON.parse(body);
        if (data?.code && Number(data.code) !== 200) {
          const code = Number(data.code);
          throw new SourceError('payload-status', code, code === 408 || code >= 500);
        }
        if (!Array.isArray(data?.results)) throw new SourceError('invalid-payload', 0, true);
        return data;
      }, 2);
      const posts = timelinePostsFromFxData(payload, handle, 100);
      for (const post of posts) collected.set(post.id, post);
      cursor = timelineCursorFromFxData(payload);
      // Check the whole page, not just its oldest post: pinned/out-of-order posts may appear.
      const pastPeriod = posts.length > 0 && posts.every(post => {
        const date = xPostDateKey(post.published_at);
        return date !== '' && date < startDate;
      });
      if (!cursor || pastPeriod) return result(false);
      if (result(false).posts.length >= maximum || seenCursors.has(cursor)) return result(true);
      seenCursors.add(cursor);
    }
    return result(true);
  } catch {
    // Keep successful pages. A partial response must never masquerade as a complete timeline.
    if (result(false).posts.length) return result(true);
  }

  for (const host of ['syndication.x.com', 'syndication.twitter.com']) {
    try {
      const posts = await read(`https://${host}/srv/timeline-profile/screen-name/${encodeURIComponent(handle)}`, host,
        body => postsWithinDateRange(timelinePostsFromData(extractTimelineData(body), handle, maximum), startDate, endDate));
      for (const post of posts) collected.set(post.id, post);
      if (result(false).posts.length) return result(true); // Fallback only exposes a limited window.
    } catch { /* Try the remaining public source within the same time budget. */ }
  }
  throw new Error(rateLimited ? 'X_TIMELINE_RATE_LIMITED' : 'X_TIMELINE_UNAVAILABLE');
}
