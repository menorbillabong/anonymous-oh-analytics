import { fetchLookupPost } from '@/lib/x-bulk-lookup';

export const maxDuration = 60;
export async function POST(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
  if (!token) return reply({ error: 'Entre novamente para continuar.' }, 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return reply({ error: 'Busca indisponível.' }, 503);
  async function rpc(action: string, data: Record<string, unknown>) {
    const response = await fetch(`${url}/rest/v1/rpc/my_x_lookup`, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(8_000),
      headers: { apikey: key!, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_action: action, p_data: data }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.code === '42501' ? 'Acesso não autorizado. Reabra a janela ou entre novamente.' : payload.message || 'Não foi possível salvar a consulta.');
    return payload;
  }
  try {
    const body = await request.text();
    if (body.length > 200) return reply({ error: 'Pedido inválido.' }, 400);
    const { run_id } = JSON.parse(body);
    if (typeof run_id !== 'string' || !/^[a-f0-9-]{36}$/i.test(run_id)) return reply({ error: 'Pesquisa inválida.' }, 400);
    // Claim chooses the next saved handle, never an arbitrary URL from the browser.
    const claim = await rpc('claim', { run_id });
    if (claim.done) return reply({ done: true });
    let result: Record<string, unknown>;
    let limited = false;
    try {
      const post = await fetchLookupPost(claim.handle, claim.include_reposts);
      result = post ? { status: 'found', ...post } : { status: 'empty', message: 'Nenhuma publicação elegível na consulta pública.' };
    } catch (error) {
      const message = error instanceof Error && !['SyntaxError', 'TimeoutError', 'TypeError'].includes(error.name) ? error.message : 'Consulta temporariamente indisponível. Tente novamente depois.';
      limited = message.includes('limitou');
      result = { status: 'error', message };
    }
    const search = await rpc('complete', { ...result, run_id, claim_id: claim.claim_id });
    return reply({ search, limited });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : 'Não foi possível concluir a busca. Seu progresso foi mantido.' }, 409);
  }
}
