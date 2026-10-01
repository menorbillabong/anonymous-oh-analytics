'use client';

import {useEffect, useRef, useState} from 'react';
import {supabase} from '@/lib/supabase';

type Preview = {email: string; last_activity_at: string; can_delete: boolean; posts: number; archives: number};
type Backup = {id: string; email: string; created_at: string};
const messageOf = (error: unknown) => error && typeof error === 'object' && 'message' in error
  ? String(error.message) : 'Não foi possível concluir a solicitação.';

export function AdminAccountReview({userId, name, onClose, onDeleted}: {
  userId: string; name: string; onClose: () => void; onDeleted: (backupId: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  useEffect(() => {
    let active = true;
    setPreview(null); setLoading(true);
    void (async () => {
      try {
        const {data, error} = await supabase.rpc('admin_preview_account_review', {p_target_user: userId});
        if (error) throw error;
        if (active) setPreview(data as Preview);
      } catch (error) { if (active) setNotice(messageOf(error)); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [userId]);

  async function removeAccount() {
    if (working || !preview?.can_delete || confirmation.trim() !== preview.email || reason.trim().length < 3) return;
    if (!window.confirm(`Excluir a conta de ${name}? A cópia de segurança será salva antes da exclusão. O acesso será encerrado e uma restauração exigirá intervenção administrativa e nova senha.`)) return;
    setWorking(true); setNotice('');
    try {
      const {data, error} = await supabase.rpc('admin_delete_reviewed_account', {
        p_target_user: userId, p_confirmation: confirmation.trim(), p_reason: reason.trim(),
        p_expected_activity: preview.last_activity_at,
      });
      if (error) throw error;
      if (!data?.deleted || !data?.backup_id) throw new Error('Resposta não confirmada. Atualize a lista antes de tentar novamente.');
      await onDeleted(String(data.backup_id));
    } catch (error) { setNotice(messageOf(error)); setPreview(null); }
    finally { setWorking(false); }
  }

  return <dialog ref={dialog} className="admin-account-review admin-date-delete-dialog" aria-labelledby="account-review-title"
    onCancel={event => { event.preventDefault(); if (!working) onClose(); }}>
    <div className="admin-date-delete-head"><div><small>REVISÃO MANUAL</small><h2 id="account-review-title">Revisar conta inativa</h2><p>{name}</p></div><button aria-label="Fechar" disabled={working} onClick={onClose}>×</button></div>
    <div className="admin-date-delete-body">
      <p className="admin-date-delete-warning">Nenhuma conta é apagada automaticamente. Você pode manter a conta sem tomar nenhuma ação.</p>
      {loading && <p role="status">Conferindo a atividade real e os dados da conta...</p>}
      {preview && <>
        <p>Última atividade: {new Date(preview.last_activity_at).toLocaleString('pt-BR')}.</p>
        <p>{preview.posts} publicação(ões) e {preview.archives} período(s) arquivado(s).</p>
        {!preview.can_delete ? <p role="status">Conta protegida ou com atividade recente. A exclusão está bloqueada.</p> : <>
          <p className="admin-date-delete-note">Ao confirmar, os dados do site serão copiados para uma área restrita antes da exclusão. Senhas e tokens não fazem parte da cópia. A recuperação dos dados não é automática.</p>
          <div className="admin-date-delete-fields">
            <label><span>Para confirmar, digite: {preview.email}</span><input value={confirmation} autoComplete="off" disabled={working} onChange={event => setConfirmation(event.target.value)}/></label>
            <label><span>Motivo da exclusão</span><textarea value={reason} maxLength={500} disabled={working} onChange={event => setReason(event.target.value)}/></label>
          </div>
        </>}
      </>}
      {notice && <p className="admin-date-notice" role="alert">{notice} Feche e reabra a revisão para consultar o estado atual.</p>}
    </div>
    <div className="admin-date-delete-actions"><button disabled={working} onClick={onClose}>MANTER CONTA / VOLTAR</button><button className="danger"
      disabled={working || !preview?.can_delete || confirmation.trim() !== preview?.email || reason.trim().length < 3}
      onClick={() => void removeAccount()}>{working ? 'SALVANDO CÓPIA E EXCLUINDO...' : 'CRIAR CÓPIA E EXCLUIR CONTA'}</button></div>
  </dialog>;
}

export function AdminAccountBackups() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [notice, setNotice] = useState('Carregando cópias...');
  const [working, setWorking] = useState('');
  const [deleting, setDeleting] = useState<Backup | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const lock = useRef(false);
  const confirmationInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (deleting) confirmationInput.current?.focus(); }, [deleting]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const {data, error} = await supabase.rpc('admin_account_backups');
        if (error) throw error;
        if (active) { setBackups(Array.isArray(data) ? data : []); setNotice(''); }
      } catch (error) { if (active) setNotice(messageOf(error)); }
    })();
    return () => { active = false; };
  }, []);
  async function download(id: string) {
    if (lock.current || deleting) return;
    lock.current = true;
    setWorking(id); setNotice('');
    try {
      const {data, error} = await supabase.rpc('admin_account_backups', {p_backup_id: id});
      if (error) throw error;
      if (!data?.snapshot) throw new Error('Cópia não encontrada.');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
      const link = document.createElement('a');
      link.href = url; link.download = `account-backup-${id}.json`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setNotice(messageOf(error)); }
    finally { lock.current = false; setWorking(''); }
  }
  async function deleteBackup() {
    if (lock.current || !deleting || confirmation.trim() !== 'EXCLUIR') return;
    const target = deleting;
    lock.current = true; setWorking(`delete:${target.id}`); setNotice('');
    try {
      const {data, error} = await supabase.rpc('admin_delete_account_backup', {
        p_backup_id: target.id, p_confirmation: confirmation.trim(),
      });
      if (error) throw error;
      if (!data?.deleted || data.backup_id !== target.id) throw new Error('Exclusão não confirmada. Atualize a página para conferir a lista.');
      setBackups(current => current.filter(backup => backup.id !== target.id));
      setDeleting(null); setConfirmation('');
      setNotice('Cópia excluída do site. Nenhuma conta ou publicação atual foi alterada. Arquivos já baixados não foram removidos.');
    } catch (error) { setNotice(messageOf(error)); }
    finally { lock.current = false; setWorking(''); }
  }
  return <div className="admin-panel admin-account-backups">
    <div className="admin-panel-head"><div><small>SEGURANÇA DE CONTAS</small><h2>Cópias de exclusões manuais</h2></div></div>
    <p className="admin-panel-copy">Apenas administradores têm acesso. Guarde os arquivos em local seguro; eles contêm dados pessoais. Cópias anteriores a esta proteção não são criadas retroativamente.</p>
    {notice && <p role="status">{notice}</p>}
    {!notice && !backups.length && <p>Nenhuma cópia disponível.</p>}
    {deleting && <div className="admin-backup-confirm" role="group" aria-labelledby="backup-delete-title">
      <h3 id="backup-delete-title">Excluir esta cópia de segurança?</h3>
      <p><strong>{deleting.email}</strong> — {new Date(deleting.created_at).toLocaleString('pt-BR')}</p>
      <p>Esta ação é definitiva no site. Você perderá a possibilidade de recuperar os dados por esta cópia. Nenhuma conta ou publicação atual será apagada. Arquivos já baixados continuarão no seu computador.</p>
      <label htmlFor="backup-delete-confirmation">Digite EXCLUIR para confirmar</label>
      <input ref={confirmationInput} id="backup-delete-confirmation" value={confirmation} autoComplete="off" disabled={Boolean(working)} onChange={event => setConfirmation(event.target.value)}/>
      <div className="admin-backup-actions">
        <button type="button" className="admin-outline" disabled={Boolean(working)} onClick={() => { setDeleting(null); setConfirmation(''); }}>CANCELAR</button>
        <button type="button" className="admin-outline admin-backup-danger" disabled={Boolean(working) || confirmation.trim() !== 'EXCLUIR'} onClick={() => void deleteBackup()}>{working ? 'EXCLUINDO...' : 'EXCLUIR DEFINITIVAMENTE'}</button>
      </div>
    </div>}
    {backups.map(backup => <div key={backup.id} className="admin-control-row"><div><strong>{backup.email}</strong><p>{new Date(backup.created_at).toLocaleString('pt-BR')}</p></div>
      <div className="admin-backup-actions"><button type="button" className="admin-outline" disabled={Boolean(working) || Boolean(deleting)} onClick={() => void download(backup.id)}>{working === backup.id ? 'BAIXANDO...' : 'BAIXAR CÓPIA'}</button>
      <button type="button" className="admin-outline admin-backup-danger" disabled={Boolean(working) || Boolean(deleting)} aria-label={`Excluir cópia de ${backup.email}`} onClick={() => { setDeleting(backup); setConfirmation(''); setNotice(''); }}>EXCLUIR CÓPIA</button></div></div>)}
  </div>;
}
