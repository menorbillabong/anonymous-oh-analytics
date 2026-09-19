import { postDateKey, postPublishedDate, postPublishedValue } from './post-date.ts';

export type ActivePeriod = {
  id: number;
  start_date: string;
  opened_at: string;
  oldest_current_post?: string | null;
  close_available_on?: string | null;
  early_release_source?: 'individual' | 'global' | null;
  can_close?: boolean;
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

// Compare in the period's time zone without changing the original publication fields.
export function publicationIsWithinPeriod(post: {
  x_published_at?: string | null;
  published_at?: string | null;
  published_date?: string | null;
  created_at?: string | null;
}, start: string, end: string) {
  return postIsWithinPeriod(postPublishedValue(post), start, end);
}
