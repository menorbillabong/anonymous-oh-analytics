'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabase';
import { normalizedXHandle, validXHandle } from '@/lib/x-handle';
import './x-import-controls.css';

type Props = {
  userId: string;
  enabled: boolean;
  handle: string;
  busy: boolean;
  atMonthlyLimit: boolean;
  onSearch: () => void;
  onHandleSaved: (handle: string) => void;
};

export default function XImportControls({ userId, enabled, handle, busy, atMonthlyLimit, onSearch, onHandleSaved }: Props) {
  const [checking, setChecking] = useState(false);
  const [editor, setEditor] = useState<{ handle: string; searchAfterSave: boolean } | null>(null);
  const [message, setMessage] = useState('');
  const lock = useRef(false);

  async function open(search: boolean) {
    if (!enabled || busy || lock.current || (search && atMonthlyLimit)) return;
    lock.current = true; setChecking(true); setMessage('');
    try {
      // Refresh permission and saved handle: settings may have changed in another tab.
      const { data, error } = await supabase.rpc('get_my_x_import_access');
      if (error) throw error;
      if (!data?.enabled) { setMessage('A busca automática não está liberada para esta conta.'); return; }
      const current = normalizedXHandle(data.handle);
      if (search && validXHandle(current)) { onHandleSaved(current); onSearch(); }
      else setEditor({ handle: current, searchAfterSave: search });
    } catch { setMessage('Não foi possível verificar o perfil do X. Tente novamente.'); }
    finally { lock.current = false; setChecking(false); }
  }

  if (!enabled) return null;
  return <div className="x-import-control">
    <div className="x-import-button-pair" role="group" aria-label="Buscar no X e configurar perfil">
      <button type="button" className="orange-add x-import-search" disabled={busy || checking || atMonthlyLimit} title={atMonthlyLimit ? 'Meta mensal atingida' : validXHandle(handle) ? `Buscar publicações de @${normalizedXHandle(handle)}` : 'Cadastre seu @ do X para buscar publicações'} onClick={() => void open(true)}>𝕏 <b>{checking ? 'AGUARDE...' : 'BUSCAR NO X'}</b></button>
      <button type="button" className="orange-add x-import-gear" disabled={busy || checking} aria-label="Cadastrar ou alterar perfil do X" title="Cadastrar ou alterar perfil do X" onClick={() => void open(false)}><span aria-hidden="true">⚙</span></button>
    </div>
    {message && <p className="x-import-feedback" role="alert">{message}</p>}
    {editor && createPortal(<XHandleDialog userId={userId} initialHandle={editor.handle} searchAfterSave={editor.searchAfterSave} onClose={() => setEditor(null)} onSaved={saved => {
      onHandleSaved(saved); setEditor(null); setMessage('Perfil do X salvo.');
      if (editor.searchAfterSave) onSearch();
    }}/>, document.body)}
  </div>;
}

function XHandleDialog({ userId, initialHandle, searchAfterSave, onClose, onSaved }: {
  userId: string; initialHandle: string; searchAfterSave: boolean;
  onClose: () => void; onSaved: (handle: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const [value, setValue] = useState(initialHandle);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); previousFocus?.focus(); };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    const next = normalizedXHandle(value);
    if (!validXHandle(next)) { setErrorMessage('Informe um @ do X válido, com até 15 letras, números ou _.'); return; }
    lock.current = true; setSaving(true); setErrorMessage('');
    try {
      const access = await supabase.rpc('get_my_x_import_access');
      if (access.error) throw access.error;
      if (!access.data?.enabled) { setErrorMessage('A busca automática não está liberada para esta conta.'); return; }
      // Update ONLY this field. Do not overwrite appearance, goals or unsaved settings.
      // single() also rejects updates that affected no accessible row under RLS.
      const { data, error } = await supabase.from('user_settings')
        .update({ x_handle: next, updated_at: new Date().toISOString() })
        .eq('user_id', userId).select('x_handle').single();
      if (error || !data || normalizedXHandle(data.x_handle) !== next) throw error || new Error('SAVE_NOT_CONFIRMED');
      onSaved(next);
    } catch { setErrorMessage('Não foi possível salvar o perfil do X. Tente novamente.'); }
    finally { lock.current = false; setSaving(false); }
  }

  return <dialog ref={dialog} className="x-handle-dialog" aria-labelledby="x-handle-title" aria-describedby="x-handle-description" onCancel={event => { event.preventDefault(); if (!lock.current) onClose(); }}>
    <form onSubmit={save}>
      <header><h2 id="x-handle-title">Perfil do X</h2><button type="button" aria-label="Fechar" disabled={saving} onClick={onClose}>×</button></header>
      <p id="x-handle-description">{searchAfterSave ? 'Cadastre seu perfil do X para continuar.' : 'Cadastre ou altere o @ usado nas buscas de publicações.'}</p>
      <label htmlFor="x-import-handle">Seu @ do X</label>
      <input id="x-import-handle" autoFocus required maxLength={16} autoCapitalize="none" autoComplete="off" spellCheck={false} placeholder="@seu_perfil" value={value} disabled={saving} aria-invalid={Boolean(errorMessage)} aria-describedby="x-handle-help x-handle-error" onChange={event => { setValue(event.target.value); setErrorMessage(''); }}/>
      <p id="x-handle-help">Use @usuario ou usuario. O mesmo perfil ficará salvo nas Configurações.</p>
      <p id="x-handle-error" className="x-import-feedback" role="alert">{errorMessage}</p>
      <footer><button type="button" disabled={saving} onClick={onClose}>Cancelar</button><button type="submit" className="x-handle-save" disabled={saving || !validXHandle(value)}>{saving ? 'Salvando...' : searchAfterSave ? 'Salvar e buscar' : 'Salvar perfil'}</button></footer>
    </form>
  </dialog>;
}
