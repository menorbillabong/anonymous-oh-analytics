export type PublicationPeriod = 'current' | 'previous';

export function isActiveCountingPost(post: any) {
  return !Boolean(post?.counting_excluded);
}

export function postsForPublicationPeriod(posts: any[], period: PublicationPeriod) {
  return posts.filter((post) => period === 'current'
    ? isActiveCountingPost(post)
    : !isActiveCountingPost(post));
}
