import { postDateKey, postPublishedDate } from './post-date.ts';

export type ActivePeriod = {
  id: number;
  start_date: string;
  opened_at: string;
  oldest_current_post?: string | null;
};

export function defaultPeriodStart(todayKey: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(todayKey) ? `${todayKey.slice(0, 7)}-01` : '';
}

export function oldestActivePostDate(posts: any[]) {
  return posts.reduce((oldest, post) => {
    if (post?.counting_excluded) return oldest;
    const date = postDateKey(postPublishedDate(post));
    return date && (!oldest || date < oldest) ? date : oldest;
  }, '');
}

export function postIsWithinPeriod(value: any, start: string, end: string) {
  const date = postDateKey(value);
  return Boolean(date && start && end && date >= start && date <= end);
}
