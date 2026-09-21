type SearchableUser = {
  profile_name?: string;
  username?: string;
  display_name?: string;
  email?: string;
  x_handle?: string;
};

export function adminUserDisplayName(user: SearchableUser) {
  return user.profile_name || user.username || user.display_name || user.x_handle || 'Sem nome';
}

const userNameCollator = new Intl.Collator('pt-BR', {sensitivity: 'base', numeric: true});

export function sortUsersByDisplayName<T extends SearchableUser>(users: readonly T[]): T[] {
  return [...users].sort((a, b) => userNameCollator.compare(adminUserDisplayName(a).trim(), adminUserDisplayName(b).trim()));
}

export function normalizeUserSearch(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR').trim().replace(/\s+/g, ' ');
}

export function userMatchesSearch(user: SearchableUser, query: string) {
  const terms = normalizeUserSearch(query).split(' ').filter(Boolean);
  const fields = [user.profile_name, user.username, user.display_name, user.email, user.x_handle]
    .map(normalizeUserSearch);
  return terms.every(term => fields.some(field => field.includes(term)));
}

export function accountNeedsReview(user: {is_admin?: boolean; inactive_days?: number}, reviewDays: number) {
  const days = Number(user.inactive_days ?? 0);
  return !user.is_admin && Number.isFinite(days) && days >= reviewDays;
}
