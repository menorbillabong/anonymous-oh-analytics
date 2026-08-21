'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatPostDate, postPublishedDate } from '@/lib/post-date';
import './admin.css';

type AdminSection = 'Visão geral' | 'Usuários' | 'Publicações' | 'Auditoria' | 'Controles';

type AdminUser = {
  id: string;
  email?: string;
  username?: string;
  display_name?: string;
  x_handle?: string;
  created_at?: string;
  last_activity_at?: string;
  inactive_days?: number;
  suspended?: boolean;
  suspension_reason?: string;
  ranking_blocked?: boolean;
  ranking_control_unlocked?: boolean;
  is_admin?: boolean;
  deletion_scheduled_at?: string;
  deletion_execute_after?: string;
  sheets_sync_enabled?: boolean;
  sheets_tab_name?: string;
  sheets_last_sync_at?: string;
  sheets_last_sync_status?: string;
};

type AdminPost = {
  id: number;
  user_id: string;
  title?: string;
  post_url?: string;
  author_handle?: string;
  published_at?: string;
  x_published_at?: string;
  views?: number;
  likes?: number;
  admin_eligible?: boolean;
  admin_reason?: string;
};

type AuditLog = {
  id: number;
  action: string;
  reason?: string;
  target_email?: string;
  target_username?: string;
  post_id?: number;
  created_at: string;
};

type AdminDashboard = {
  controls?: { ranking_self_service_enabled?: boolean };
  cleanup?: { auto_delete_enabled?: boolean; inactivity_days?: number; grace_days?: number; updated_at?: string };
  users?: AdminUser[];
  posts?: AdminPost[];
  periods?: Array<{ id: number; status?: string }>;
  logs?: AuditLog[];
};

const sections: AdminSection[] = ['Visão geral', 'Usuários', 'Publicações', 'Auditoria', 'Controles'];

export default function AdminPanel() {
  const [section, setSection] = useState<AdminSection>('Visão geral');
  const [dashboard, setDashboard] = useState<AdminDashboard>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [cleanupEnabled, setCleanupEnabled] = useState(false);
  const [inactivityDays, setInactivityDays] = useState(90);
  const [graceDays, setGraceDays] = useState(7);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data, error }, { data: sheetsData }] = await Promise.all([
      supabase.rpc('admin_dashboard'),
      supabase.rpc('admin_google_sheets_users'),
    ]);
    if (error) {
      setMessage('Não foi possível carregar o painel administrativo.');
      setLoading(false);
      return;
    }
    const next = (data || {}) as AdminDashboard;
    const sheetsByUser = new Map((Array.isArray(sheetsData) ? sheetsData : []).map((config:any) => [String(config.user_id), config]));
    next.users = (next.users || []).map(user => {
      const config:any = sheetsByUser.get(user.id) || {};
      return {...user, sheets_sync_enabled:Boolean(config.enabled), sheets_tab_name:String(config.sheet_tab_name || ''), sheets_last_sync_at:config.last_sync_completed_at, sheets_last_sync_status:config.last_sync_status};
    });
    setDashboard(next);
    setCleanupEnabled(Boolean(next.cleanup?.auto_delete_enabled));
    setInactivityDays(Number(next.cleanup?.inactivity_days || 90));
    setGraceDays(Number(next.cleanup?.grace_days || 7));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const users = dashboard.users || [];
  const posts = useMemo(()=>[...(dashboard.posts || [])].sort((a,b)=>(postPublishedDate(b)?.getTime()||0)-(postPublishedDate(a)?.getTime()||0)),[dashboard.posts]);
  const logs = dashboard.logs || [];
  const normalizedSearch = search.trim().toLowerCase();
  const filteredUsers = useMemo(() => users.filter(user =>
    !normalizedSearch || [user.username, user.display_name, user.email, user.x_handle]
      .some(value => String(value || '').toLowerCase().includes(normalizedSearch))
  ), [users, normalizedSearch]);
  const filteredPosts = useMemo(() => posts.filter(post =>
    !normalizedSearch || [post.title, post.author_handle, post.post_url]
      .some(value => String(value || '').toLowerCase().includes(normalizedSearch))
  ), [posts, normalizedSearch]);

  async function run(key: string, request: () => PromiseLike<{ error: { message?: string } | null }>, success: string) {
    setBusy(key);
    setMessage('');
    try {
      const { error } = await request();
      if (error) throw error;
      setMessage(success);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível concluir a ação.');
    } finally {
      setBusy('');
    }
  }

  function reasonFor(label: string) {
    const reason = window.prompt(`Informe o motivo para ${label}:`);
    if (!reason) return null;
    if (reason.trim().length < 3) {
      setMessage('O motivo precisa ter pelo menos 3 caracteres.');
      return null;
    }
    return reason.trim();
  }

  async function manageUser(user: AdminUser, action: 'suspend' | 'reactivate' | 'block_ranking' | 'unblock_ranking' | 'unlock_ranking_control' | 'lock_ranking_control', label: string) {
    const reason = reasonFor(label);
    if (!reason) return;
    await run(`user-${user.id}`, () => supabase.rpc('admin_manage_account', {
      p_action: action,
      p_target_user: user.id,
      p_reason: reason,
      p_post_id: null,
    }), 'Conta atualizada com sucesso.');
  }

  async function scheduleDeletion(user: AdminUser) {
    const reason = reasonFor('agendar a exclusão desta conta');
    if (!reason) return;
    await run(`delete-${user.id}`, () => supabase.rpc('admin_schedule_account_deletion', {
      p_target_user: user.id,
      p_reason: reason,
    }), 'Exclusão da conta agendada.');
  }

  async function cancelDeletion(user: AdminUser) {
    if (!window.confirm('Cancelar a exclusão agendada desta conta?')) return;
    await run(`delete-${user.id}`, () => supabase.rpc('admin_cancel_account_deletion', {
      p_target_user: user.id,
    }), 'Exclusão agendada cancelada.');
  }

  async function reviewPost(post: AdminPost, action: 'disqualify_post' | 'requalify_post') {
    const reason = reasonFor(action === 'disqualify_post' ? 'desqualificar esta publicação' : 'requalificar esta publicação');
    if (!reason) return;
    await run(`post-${post.id}`, () => supabase.rpc('admin_manage_account', {
      p_action: action,
      p_target_user: post.user_id,
      p_reason: reason,
      p_post_id: post.id,
    }), 'Publicação revisada com sucesso.');
  }

  async function toggleGlobalRanking() {
    const enabled = !dashboard.controls?.ranking_self_service_enabled;
    if (!window.confirm(`${enabled ? 'Ativar' : 'Desativar'} o controle global de participação no ranking?`)) return;
    await run('global-ranking', () => supabase.rpc('admin_set_global_ranking_control', {
      p_enabled: enabled,
    }), 'Controle global do ranking atualizado.');
  }

  async function saveCleanup() {
    if (inactivityDays < 30 || graceDays < 1) {
      setMessage('Use ao menos 30 dias de inatividade e 1 dia de carência.');
      return;
    }
    await run('cleanup', () => supabase.rpc('admin_set_account_cleanup', {
      p_enabled: cleanupEnabled,
      p_inactivity_days: inactivityDays,
      p_grace_days: graceDays,
    }), 'Política de limpeza automática atualizada.');
  }

  const suspendedCount = users.filter(user => user.suspended).length;
  const blockedCount = users.filter(user => user.ranking_blocked).length;
  const reviewedCount = posts.filter(post => post.admin_eligible === false).length;
  const scheduledCount = users.filter(user => user.deletion_scheduled_at).length;

  if (loading) return <div className="admin-loading"><span>↻</span> CARREGANDO CONTROLE ADMINISTRATIVO</div>;

  return <section className="admin-shell">
    <div className="admin-hero">
      <div>
        <small>ANONYMOUS_OH · ÁREA RESTRITA</small>
        <h1>CONTROLE ADMINISTRATIVO</h1>
        <p>Gerencie contas, publicações, ranking e segurança em um único painel.</p>
      </div>
      <div className="admin-hero-badge"><i/> ADMIN ATIVO</div>
    </div>

    <div className="admin-tabs">
      {sections.map(item => <button key={item} className={section === item ? 'active' : ''} onClick={() => setSection(item)}>{item}</button>)}
      <button className="admin-refresh" disabled={Boolean(busy)} onClick={() => void load()}>↻ ATUALIZAR</button>
    </div>

    {message && <div className="admin-message">{message}<button onClick={() => setMessage('')}>×</button></div>}

    <div className="admin-stats">
      <AdminStat label="CONTAS CADASTRADAS" value={users.length} detail={`${suspendedCount} suspensa(s)`}/>
      <AdminStat label="PUBLICAÇÕES" value={posts.length} detail={`${reviewedCount} desqualificada(s)`}/>
      <AdminStat label="BLOQUEIOS DE RANKING" value={blockedCount} detail="Controle individual"/>
      <AdminStat label="EXCLUSÕES AGENDADAS" value={scheduledCount} detail="Fila de segurança"/>
    </div>

    {section === 'Visão geral' && <div className="admin-overview">
      <div className="admin-panel">
        <div className="admin-panel-head"><div><small>STATUS DO SISTEMA</small><h2>Controles rápidos</h2></div><span className="admin-status">● OPERACIONAL</span></div>
        <div className="admin-control-row">
          <div><strong>Controle de ranking pelos usuários</strong><p>Permite que cada conta escolha participar ou não do ranking.</p></div>
          <button className={dashboard.controls?.ranking_self_service_enabled ? 'admin-toggle on' : 'admin-toggle'} disabled={busy === 'global-ranking'} onClick={toggleGlobalRanking}><i/>{dashboard.controls?.ranking_self_service_enabled ? 'ATIVADO' : 'DESATIVADO'}</button>
        </div>
        <div className="admin-control-row">
          <div><strong>Limpeza automática de contas</strong><p>{cleanupEnabled ? `Contas inativas por ${inactivityDays} dias · carência de ${graceDays} dias.` : 'A limpeza automática está desativada.'}</p></div>
          <button className="admin-outline" onClick={() => setSection('Controles')}>CONFIGURAR</button>
        </div>
      </div>
      <div className="admin-panel">
        <div className="admin-panel-head"><div><small>ATIVIDADE RECENTE</small><h2>Últimas ações administrativas</h2></div><button className="admin-link" onClick={() => setSection('Auditoria')}>VER TODAS</button></div>
        <AuditRows logs={logs.slice(0, 6)}/>
      </div>
    </div>}

    {section === 'Usuários' && <div className="admin-panel">
      <PanelHeading eyebrow="GESTÃO DE CONTAS" title="Usuários" search={search} setSearch={setSearch}/>
      <div className="admin-table-scroll"><div className="admin-user-table">
        <div className="admin-table-head"><span>USUÁRIO</span><span>STATUS</span><span>RANKING</span><span>ATIVIDADE</span><span>GOOGLE SHEETS</span><span>AÇÕES</span></div>
        {filteredUsers.map(user => <div className="admin-user-row" key={user.id}>
          <div className="admin-user-identity"><i>{String(user.username || user.display_name || user.email || '?').slice(0, 1).toUpperCase()}</i><div><strong>{user.username || user.display_name || user.x_handle || 'Sem nome'}</strong>{user.is_admin && <em>ADMINISTRADOR</em>}</div></div>
          <div><StatusTag tone={user.suspended ? 'danger' : 'success'}>{user.suspended ? 'SUSPENSA' : 'ATIVA'}</StatusTag>{user.suspension_reason && <small className="admin-reason">{user.suspension_reason}</small>}</div>
          <div><StatusTag tone={user.ranking_blocked ? 'danger' : user.ranking_control_unlocked ? 'warning' : 'neutral'}>{user.ranking_blocked ? 'BLOQUEADO' : user.ranking_control_unlocked ? 'LIBERADO' : 'PADRÃO'}</StatusTag></div>
          <div><strong>{Number(user.inactive_days || 0)} dia(s)</strong><small>{formatDate(user.last_activity_at)}</small></div>
          <SheetsAccess user={user} onSaved={load}/>
          <div className="admin-row-actions">
            <button disabled={busy === `user-${user.id}` || user.is_admin} onClick={() => manageUser(user, user.suspended ? 'reactivate' : 'suspend', user.suspended ? 'reativar esta conta' : 'suspender esta conta')}>{user.suspended ? 'REATIVAR' : 'SUSPENDER'}</button>
            <button disabled={busy === `user-${user.id}`} onClick={() => manageUser(user, user.ranking_blocked ? 'unblock_ranking' : 'block_ranking', user.ranking_blocked ? 'liberar esta conta no ranking' : 'bloquear esta conta no ranking')}>{user.ranking_blocked ? 'LIBERAR RANKING' : 'BLOQUEAR RANKING'}</button>
            <button disabled={busy === `user-${user.id}`} onClick={() => manageUser(user, user.ranking_control_unlocked ? 'lock_ranking_control' : 'unlock_ranking_control', user.ranking_control_unlocked ? 'bloquear o controle individual do ranking' : 'liberar o controle individual do ranking')}>{user.ranking_control_unlocked ? 'TRAVAR CONTROLE' : 'LIBERAR CONTROLE'}</button>
            {user.deletion_scheduled_at ? <button className="safe" disabled={busy === `delete-${user.id}`} onClick={() => cancelDeletion(user)}>CANCELAR EXCLUSÃO</button> : <button className="danger" disabled={busy === `delete-${user.id}` || user.is_admin} onClick={() => scheduleDeletion(user)}>AGENDAR EXCLUSÃO</button>}
          </div>
        </div>)}
        {!filteredUsers.length && <div className="admin-empty">Nenhum usuário encontrado.</div>}
      </div></div>
    </div>}

    {section === 'Publicações' && <div className="admin-panel">
      <PanelHeading eyebrow="MODERAÇÃO DE CONTEÚDO" title="Publicações" search={search} setSearch={setSearch}/>
      <div className="admin-post-grid">
        {filteredPosts.map(post => <article className="admin-post-card" key={post.id}>
          <div className="admin-post-top"><StatusTag tone={post.admin_eligible === false ? 'danger' : 'success'}>{post.admin_eligible === false ? 'DESQUALIFICADA' : 'ELEGÍVEL'}</StatusTag><small>#{post.id}</small></div>
          <h3>{post.title || 'Publicação do X'}</h3>
          <p>@{String(post.author_handle || 'sem_identificação').replace(/^@/, '')} · {formatDate(post.x_published_at || post.published_at)}</p>
          <div className="admin-post-metrics"><span><small>VISUALIZAÇÕES</small><b>{Number(post.views || 0).toLocaleString('pt-BR')}</b></span><span><small>CURTIDAS</small><b>{Number(post.likes || 0).toLocaleString('pt-BR')}</b></span></div>
          {post.admin_reason && <div className="admin-post-reason">Motivo: {post.admin_reason}</div>}
          <button disabled={busy === `post-${post.id}`} className={post.admin_eligible === false ? 'safe' : 'danger'} onClick={() => reviewPost(post, post.admin_eligible === false ? 'requalify_post' : 'disqualify_post')}>{post.admin_eligible === false ? 'REQUALIFICAR PUBLICAÇÃO' : 'DESQUALIFICAR PUBLICAÇÃO'}</button>
        </article>)}
        {!filteredPosts.length && <div className="admin-empty">Nenhuma publicação encontrada.</div>}
      </div>
    </div>}

    {section === 'Auditoria' && <div className="admin-panel">
      <div className="admin-panel-head"><div><small>REGISTRO DE SEGURANÇA</small><h2>Histórico administrativo</h2></div><span className="admin-counter">{logs.length} REGISTROS</span></div>
      <AuditRows logs={logs}/>
    </div>}

    {section === 'Controles' && <div className="admin-controls-grid">
      <div className="admin-panel">
        <div className="admin-panel-head"><div><small>RANKING</small><h2>Controle global</h2></div><StatusTag tone={dashboard.controls?.ranking_self_service_enabled ? 'success' : 'neutral'}>{dashboard.controls?.ranking_self_service_enabled ? 'ATIVO' : 'DESATIVADO'}</StatusTag></div>
        <p className="admin-panel-copy">Defina se os usuários podem escolher livremente sua participação no ranking mensal.</p>
        <button className="admin-primary" disabled={busy === 'global-ranking'} onClick={toggleGlobalRanking}>{dashboard.controls?.ranking_self_service_enabled ? 'DESATIVAR CONTROLE GLOBAL' : 'ATIVAR CONTROLE GLOBAL'}</button>
      </div>
      <div className="admin-panel">
        <div className="admin-panel-head"><div><small>CONTAS INATIVAS</small><h2>Limpeza automática</h2></div><StatusTag tone={cleanupEnabled ? 'warning' : 'neutral'}>{cleanupEnabled ? 'CONFIGURADA' : 'DESATIVADA'}</StatusTag></div>
        <div className="admin-form">
          <label className="admin-check"><span><strong>Ativar limpeza automática</strong><small>Agenda contas após o período configurado.</small></span><input type="checkbox" checked={cleanupEnabled} onChange={event => setCleanupEnabled(event.target.checked)}/></label>
          <label><span>Dias de inatividade</span><input type="number" min="30" value={inactivityDays} onChange={event => setInactivityDays(Number(event.target.value))}/></label>
          <label><span>Dias de carência</span><input type="number" min="1" value={graceDays} onChange={event => setGraceDays(Number(event.target.value))}/></label>
          <button className="admin-primary" disabled={busy === 'cleanup'} onClick={saveCleanup}>SALVAR POLÍTICA DE LIMPEZA</button>
        </div>
      </div>
    </div>}
  </section>;
}

function AdminStat({label, value, detail}:{label:string; value:number; detail:string}) {
  return <div className="admin-stat"><small>{label}</small><strong>{value.toLocaleString('pt-BR')}</strong><span>{detail}</span></div>;
}

function PanelHeading({eyebrow, title, search, setSearch}:{eyebrow:string; title:string; search:string; setSearch:(value:string)=>void}) {
  return <div className="admin-panel-head"><div><small>{eyebrow}</small><h2>{title}</h2></div><div className="admin-search"><span>⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar..."/></div></div>;
}

function StatusTag({children, tone}:{children:React.ReactNode; tone:'success'|'danger'|'warning'|'neutral'}) {
  return <span className={`admin-tag ${tone}`}>{children}</span>;
}

function SheetsAccess({user,onSaved}:{user:AdminUser;onSaved:()=>Promise<void>}){
  const[enabled,setEnabled]=useState(Boolean(user.sheets_sync_enabled));
  const[tabName,setTabName]=useState(user.sheets_tab_name||'');
  const[saving,setSaving]=useState(false);
  const[notice,setNotice]=useState('');
  useEffect(()=>{setEnabled(Boolean(user.sheets_sync_enabled));setTabName(user.sheets_tab_name||'')},[user.sheets_sync_enabled,user.sheets_tab_name]);
  async function save(){
    const clean=tabName.trim();
    if(enabled&&!clean){setNotice('Informe o nome da aba.');return}
    const reason=window.prompt(`Informe o motivo para ${enabled?'liberar':'desativar'} o Google Sheets deste perfil:`);
    if(!reason||reason.trim().length<3){if(reason)setNotice('O motivo precisa ter pelo menos 3 caracteres.');return}
    setSaving(true);setNotice('');
    const{error}=await supabase.rpc('admin_set_google_sheets_user',{p_target_user:user.id,p_enabled:enabled,p_sheet_tab_name:clean,p_reason:reason.trim()});
    if(error){setNotice(error.message||'Não foi possível salvar.');setSaving(false);return}
    setNotice('Salvo.');setSaving(false);await onSaved();
  }
  return <div className="admin-sheets-access">
    <label><input type="checkbox" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/><span>Permitir atualização</span></label>
    <input value={tabName} onChange={event=>setTabName(event.target.value)} placeholder="Nome exato da aba" aria-label={`Nome da aba de ${user.username||user.email||'usuário'}`}/>
    <button type="button" disabled={saving} onClick={save}>{saving?'SALVANDO...':'SALVAR SHEETS'}</button>
    <small>{notice||`${user.sheets_last_sync_status==='success'?'Última atualização: ':''}${user.sheets_last_sync_status==='success'?formatDate(user.sheets_last_sync_at,true):user.sheets_sync_enabled?'Liberado':'Desativado'}`}</small>
  </div>;
}

function AuditRows({logs}:{logs:AuditLog[]}) {
  if (!logs.length) return <div className="admin-empty">Nenhuma ação administrativa registrada.</div>;
  return <div className="admin-audit-list">{logs.map(log => <div className="admin-audit-row" key={log.id}>
    <i>◆</i><div><strong>{actionLabel(log.action)}</strong><p>{log.target_username || log.target_email || 'Sistema'}{log.post_id ? ` · Publicação #${log.post_id}` : ''}</p>{log.reason && <small>{log.reason}</small>}</div><time>{formatDate(log.created_at, true)}</time>
  </div>)}</div>;
}

function actionLabel(action:string) {
  const labels:Record<string,string> = {
    suspend:'Conta suspensa', reactivate:'Conta reativada', block_ranking:'Ranking bloqueado',
    unblock_ranking:'Ranking liberado', unlock_ranking_control:'Controle de ranking liberado',
    lock_ranking_control:'Controle de ranking bloqueado', enable_global_ranking_control:'Controle global ativado',
    disable_global_ranking_control:'Controle global desativado', disqualify_post:'Publicação desqualificada',
    requalify_post:'Publicação requalificada', configure_account_cleanup:'Limpeza de contas configurada',
    schedule_account_deletion:'Exclusão agendada', cancel_account_deletion:'Exclusão cancelada',
    delete_inactive_account:'Conta inativa excluída', configure_google_sheets:'Google Sheets configurado',
  };
  return labels[action] || action.replaceAll('_', ' ');
}

function formatDate(value?:string, withTime=false) {
  if (!value) return 'Sem registro';
  return formatPostDate(value, withTime) || 'Sem registro';
}

