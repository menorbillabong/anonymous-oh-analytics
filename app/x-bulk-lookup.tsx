'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabase';
import { parseLookupHandles, safeLookupUrl, type LookupSearch } from '@/lib/x-bulk-lookup';
import './x-bulk-lookup.css';

async function updateSearch(action = 'get', data: Record<string, unknown> = {}): Promise<LookupSearch> {
  const result = await supabase.rpc('my_x_lookup', { p_action: action, p_data: data });
  if (result.error) throw new Error(result.error.message);
  if (!result.data?.enabled) throw new Error('A busca em massa não está liberada para esta conta.');
  return result.data;
}

export default function XBulkLookup({ userId }: { userId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    setEnabled(false); setOpen(false);
    const check = () => { void supabase.rpc('my_x_lookup').then(({ data, error }) => {
      if (active) { setEnabled(!error && data?.enabled === true); if (error || !data?.enabled) setOpen(false); }
    }); };
    check(); window.addEventListener('focus', check);
    return () => { active = false; window.removeEventListener('focus', check); };
  }, [userId]);
  if (!enabled) return null;
  return <><button type="button" className="orange-add" data-appearance-button="x" onClick={() => setOpen(true)}>𝕏 <b>BUSCA DE @ EM MASSA</b></button>
    {open && createPortal(<LookupDialog key={userId} onClose={() => setOpen(false)}/>, document.body)}</>;
}

export function LookupDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const stop = useRef(false);
  const running = useRef(false);
  const mutation = useRef(false);
  const restored = useRef(false);
  const [search, setSearch] = useState<LookupSearch | null>(null);
  const [text, setText] = useState('');
  const [reposts, setReposts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [resetConfirm, setResetConfirm] = useState(false);
  const [pausing, setPausing] = useState(false);
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    void updateSearch().then(value => { if (alive.current) { setSearch(value); setReposts(value.include_reposts); } }).catch(reason => { if (alive.current) setError(reason.message); });
    return () => { alive.current = false; stop.current = true; previous?.focus(); };
  }, []);
  useEffect(() => {
    if (!search || restored.current) return;
    restored.current = true;
    if (search.last_opened) document.getElementById(`lookup-${search.last_opened}`)?.scrollIntoView({ block: 'center' });
  }, [search]);

  function receive(value: LookupSearch) {
    if (!alive.current) return;
    // Ignore stale responses from a simultaneous link open or a previous search.
    setSearch(current => current && current.revision > value.revision ? current : value);
  }
  async function process(value: LookupSearch) {
    if (running.current) return;
    running.current = true; stop.current = false; setBusy(true); setPausing(false); setError('');
    try {
      let current = value;
      while (alive.current && !stop.current && current.items.some(item => item.status === 'pending')) {
        const { data } = await supabase.auth.getSession();
        if (!data.session) throw new Error('Entre novamente para continuar.');
        const response = await fetch('/api/x-posts/lookup', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ run_id: value.run_id }), signal: AbortSignal.timeout(40_000) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'A busca foi pausada. Reabra a janela para continuar.');
        if (payload.done) { receive(await updateSearch()); break; }
        current = payload.search; receive(current);
        if (payload.limited) { if (alive.current) setError('O serviço limitou as consultas. A busca foi pausada; os resultados foram mantidos.'); break; }
        if (!stop.current && alive.current) await new Promise(resolve => setTimeout(resolve, 3_200));
      }
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error && reason.name !== 'TimeoutError' ? reason.message : 'Consulta demorou mais que o esperado. Reabra a janela para conferir o progresso salvo.');
    } finally { running.current = false; if (alive.current) { setBusy(false); setPausing(false); } }
  }
  async function start() {
    if (mutation.current || running.current || !search) return;
    mutation.current = true; setSaving(true); setError('');
    try {
      const value = await updateSearch('start', { handles: parseLookupHandles(text), include_reposts: reposts });
      receive(value); void process(value);
    } catch (reason) { if (alive.current) setError((reason as Error).message); }
    finally { mutation.current = false; if (alive.current) setSaving(false); }
  }
  async function reset() {
    if (!search || running.current || mutation.current) return;
    mutation.current = true; setSaving(true); setError('');
    try { const value = await updateSearch('reset', { run_id: search.run_id, confirmation: 'REINICIAR' }); receive(value); setText(''); setResetConfirm(false); }
    catch (reason) { setError((reason as Error).message); }
    finally { mutation.current = false; setSaving(false); }
  }
  async function markOpened(handle: string) {
    if (!search) return;
    try { receive(await updateSearch('open', { run_id: search.run_id, handle })); }
    catch { if (alive.current) setError('O link abriu, mas a marcação não foi salva. Clique nele novamente para tentar salvar.'); }
  }
  async function retry() {
    if (!search || running.current || mutation.current) return;
    mutation.current = true; setSaving(true); setError('');
    try { const value = await updateSearch('retry', { run_id: search.run_id }); receive(value); void process(value); }
    catch (reason) { if (alive.current) setError((reason as Error).message); }
    finally { mutation.current = false; if (alive.current) setSaving(false); }
  }
  const items = search?.items || [];
  const pending = items.filter(item => item.status === 'pending').length;
  const found = items.filter(item => item.status === 'found').length;
  const opened = items.filter(item => item.opened).length;
  return <dialog ref={dialog} className="x-lookup-dialog" aria-labelledby="x-lookup-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><small>CONSULTA DE PERFIS</small><h2 id="x-lookup-title">Busca de @ em massa</h2></div><button type="button" aria-label="Fechar janela" onClick={onClose}>×</button></header>
    <p>Uma publicação por perfil, somente links. O ✓ indica que você abriu o link, não que curtiu a publicação.</p>
    {!search ? <p role="status">{error ? 'Não foi possível carregar a pesquisa.' : 'Carregando pesquisa salva...'}</p> : items.length === 0 ? <>
      <label htmlFor="x-lookup-handles">Perfis do X — até 100 por pesquisa</label>
      <textarea id="x-lookup-handles" value={text} disabled={saving} maxLength={2000} placeholder={'@perfil1\n@perfil2\n@perfil3'} onChange={event => setText(event.target.value)} autoCapitalize="none" spellCheck={false}/>
      <label className="x-lookup-switch"><input type="checkbox" role="switch" checked={reposts} disabled={saving} onChange={event => setReposts(event.target.checked)}/><span>Incluir repostagens</span></label>
      <p className="x-lookup-help">Desligada: somente publicações próprias. Ligada: considera também repostagens, na ordem disponibilizada pelo X. Perfis protegidos ou consultas indisponíveis podem não retornar links.</p>
      <button type="button" className="x-lookup-primary" disabled={saving || !text.trim()} onClick={() => void start()}>{saving ? 'Salvando...' : 'Iniciar busca'}</button>
    </> : <>
      <div className="x-lookup-summary" role="status">{items.length - pending}/{items.length} consultados · {found} links · {opened} abertos</div>
      <p className="x-lookup-help">Repostagens {search.include_reposts ? 'incluídas' : 'desativadas'} · Progresso salvo na sua conta. Ao fechar, a busca pausa após a consulta em andamento.</p>
      <ol className="x-lookup-list">{items.map(item => <li id={`lookup-${item.handle}`} key={item.handle} className={item.opened ? 'is-opened' : ''}>
        <strong>@{item.handle}</strong>
        {item.status === 'found' && safeLookupUrl(item.url) ? <><a href={item.url} target="_blank" rel="noopener noreferrer" onClick={() => void markOpened(item.handle)} onAuxClick={event => { if (event.button === 1) void markOpened(item.handle); }}>{item.url}</a><span>{item.opened ? '✓ Aberto' : 'Não aberto'}{item.repost ? ' · Repostagem' : ''}</span></>
          : <span>{item.status === 'pending' ? 'Aguardando consulta' : item.message || 'Sem resultado nesta consulta'}</span>}
      </li>)}</ol>
      <div className="x-lookup-actions">
        {busy ? <button type="button" disabled={pausing} onClick={() => { stop.current = true; setPausing(true); }}>{pausing ? 'Pausando...' : 'Pausar busca'}</button>
          : pending > 0 && <button type="button" className="x-lookup-primary" disabled={saving} onClick={() => void process(search)}>Continuar busca</button>}
        {!busy && items.some(item => item.status === 'error') && <button type="button" disabled={saving} onClick={() => void retry()}>Tentar falhas novamente</button>}
        <button type="button" disabled={busy || saving} onClick={() => setResetConfirm(true)}>Reiniciar pesquisa</button>
      </div>
      {resetConfirm && <section className="x-lookup-confirm" aria-label="Confirmar reinicialização"><p>Apagar os links e marcações desta pesquisa? As publicações do site não serão alteradas.</p><button type="button" disabled={saving} onClick={() => setResetConfirm(false)}>Cancelar</button><button type="button" disabled={saving} onClick={() => void reset()}>Confirmar reinicialização</button></section>}
    </>}
    {error && <p className="x-lookup-error" role="alert">{error}</p>}
  </dialog>;
}
