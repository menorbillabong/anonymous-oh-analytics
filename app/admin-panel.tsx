'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type AdminUser = {
  id: string;
  email?: string;
  username?: string;
  display_name?: string;
  suspended?: boolean;
  ranking_blocked?: boolean;
  is_admin?: boolean;
};

type AuditLog = {
  id: number;
  action: string;
  reason?: string;
  target_email?: string;
  target_username?: string;
  created_at: string;
};

export default function AdminPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    const { data, error } = await supabase.rpc('admin_dashboard');
    if (error) {
      setMessage('Não foi possível carregar os dados administrativos.');
      setLoading(false);
      return;
    }
    const dashboard = data as { users?: AdminUser[]; logs?: AuditLog[] } | null;
    setUsers(dashboard?.users || []);
    setLogs(dashboard?.logs || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function manage(user: AdminUser, action: 'suspend' | 'reactivate' | 'block_ranking' | 'unblock_ranking') {
    const labels = {
      suspend: 'suspender esta conta',
      reactivate: 'reativar esta conta',
      block_ranking: 'bloquear esta conta no ranking',
      unblock_ranking: 'liberar esta conta no ranking',
    };
    const reason = window.prompt(`Informe o motivo para ${labels[action]}:`);
    if (!reason) return;
    if (reason.trim().length < 3) {
      setMessage('O motivo precisa ter pelo menos 3 caracteres.');
      return;
    }
    setBusyUser(user.id);
    setMessage('');
    const { error } = await supabase.rpc('admin_manage_account', {
      p_action: action,
      p_target_user: user.id,
      p_reason: reason.trim(),
      p_post_id: null,
    });
    if (error) {
      setMessage(error.message || 'Não foi possível concluir a ação.');
      setBusyUser(null);
      return;
    }
    await load();
    setBusyUser(null);
  }

  return <div>
    <h1 className="page-title">Administração</h1>
    <p className="page-subtitle">Gerencie usuários, ranking e auditoria.</p>
    {message && <div className="auth-message">{message}</div>}
    {loading ? <div className="empty">Carregando painel administrativo...</div> :
      <div className="admin-grid">{users.map(user =>
        <div className="admin-user" key={user.id}>
          <h4>{user.username || user.display_name || user.email || user.id}</h4>
          <div className="muted" style={{fontSize:11}}>{user.email || user.id}</div>
          {user.is_admin && <div className="muted" style={{fontSize:11}}>Administrador</div>}
          <div className="admin-actions">
            <button className="btn" disabled={busyUser === user.id || user.is_admin} onClick={() => manage(user, user.suspended ? 'reactivate' : 'suspend')}>
              {user.suspended ? 'Reativar' : 'Suspender'}
            </button>
            <button className="btn" disabled={busyUser === user.id} onClick={() => manage(user, user.ranking_blocked ? 'unblock_ranking' : 'block_ranking')}>
              {user.ranking_blocked ? 'Liberar ranking' : 'Bloquear ranking'}
            </button>
          </div>
        </div>
      )}</div>
    }
    <div style={{height:18}}/>
    <div className="panel">
      <div className="panel-title"><h3>Histórico administrativo</h3></div>
      {logs.length ? logs.map(log =>
        <div className="admin-log" key={log.id}>
          <strong>{log.action}</strong>
          <div className="muted">
            {new Date(log.created_at).toLocaleString('pt-BR')} · {log.target_username || log.target_email || 'Conta'}{log.reason ? ` · ${log.reason}` : ''}
          </div>
        </div>
      ) : <div className="empty">Nenhuma ação registrada.</div>}
    </div>
  </div>;
}
