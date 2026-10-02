export type LookupItem = { handle: string; status: 'pending' | 'found' | 'empty' | 'error'; url?: string; opened: boolean; repost?: boolean; message?: string };
export type LookupSearch = { enabled: boolean; revision: number; run_id: string; include_reposts: boolean; items: LookupItem[]; last_opened: string | null };

export function parseLookupHandles(text: string) {
  const handles = [...new Set(text.split(/[\s,;]+/).filter(Boolean).map(value => value.replace(/^@/, '').toLowerCase()))];
  if (!handles.length || handles.length > 100) throw new Error('Informe de 1 a 100 perfis por pesquisa.');
  if (handles.some(handle => !/^[a-z0-9_]{1,15}$/.test(handle))) throw new Error('Use somente @usuario, um por linha (até 15 letras, números ou _).');
  return handles;
}

export function safeLookupUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/[0-9]{1,25}$/.test(value);
}

type Status = { type?: string; id?: string; author?: { screen_name?: string }; reposted_by?: { screen_name?: string } | null; replying_to?: unknown; created_at?: string; pinned?: boolean; is_pinned?: boolean };
/** Repost times are not exposed by this provider. Preserve timeline order when including them. */
export function selectLookupPost(values: unknown[], handle: string, includeReposts: boolean) {
  const candidates = (values as Status[]).filter(s => {
    if (!s || s.type !== 'status' || s.replying_to || !/^\d{1,25}$/.test(String(s.id || '')) || !/^[a-z0-9_]{1,15}$/i.test(s.author?.screen_name || '')) return false;
    return s.reposted_by ? includeReposts && s.reposted_by.screen_name?.toLowerCase() === handle.toLowerCase()
      : s.author?.screen_name?.toLowerCase() === handle.toLowerCase();
  });
  // Prefer regular timeline entries over explicit pinned entries.
  const unpinned = candidates.filter(s => !s.pinned && !s.is_pinned);
  const pool = unpinned.length ? unpinned : candidates;
  if (!includeReposts) pool.sort((a, b) => (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0));
  const post = pool[0];
  return post ? { url: `https://x.com/${post.author!.screen_name}/status/${post.id}`, repost: Boolean(post.reposted_by) } : null;
}

export async function fetchLookupPost(handle: string, includeReposts: boolean, fetchImpl: typeof fetch = fetch) {
  if (!/^[a-z0-9_]{1,15}$/i.test(handle)) throw new Error('Perfil inválido.');
  const response = await fetchImpl(`https://api.fxtwitter.com/2/profile/${encodeURIComponent(handle)}/statuses?count=100`, {
    cache: 'no-store', signal: AbortSignal.timeout(20_000),
    headers: { accept: 'application/json', 'user-agent': 'AnonymousOHAnalytics/2.0 (public profile link lookup)' },
  });
  if (response.status === 429) throw new Error('O serviço limitou as consultas. Tente novamente mais tarde.');
  if ([401, 403].includes(response.status)) throw new Error('Perfil protegido ou consulta pública indisponível.');
  if (response.status === 404 || response.status === 204) return null;
  if (!response.ok) throw new Error('O X não disponibilizou esta consulta agora.');
  const body = await response.text();
  if (body.length > 5_000_000) throw new Error('Resposta muito grande. Tente novamente mais tarde.');
  const data = JSON.parse(body);
  if ((data.code && data.code !== 200) || !Array.isArray(data.results)) throw new Error('O X não disponibilizou esta consulta agora.');
  return selectLookupPost(data.results, handle, includeReposts);
}
