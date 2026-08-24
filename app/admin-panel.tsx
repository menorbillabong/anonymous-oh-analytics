'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatPostDate, postPublishedDate } from '@/lib/post-date';
import './admin.css';

type AdminSection = 'Visão geral' | 'Usuários' | 'Publicações' | 'Períodos fechados' | 'Auditoria' | 'Controles';

type AdminUser = {
  id: string;
  email?: string;
  username?: string;
  display_name?: string;
  profile_name?: string;
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

type ClosedPeriodCleanup = {
  id: number;
  archive_id?: number;
  user_id: string;
  email?: string;
  username?: string;
  display_name?: string;
  profile_name?: string;
  period_start: string;
  period_end: string;
  closed_at: string;
  retention_days?: number;
  delete_after?: string;
  posts_deleted_at?: string;
  posts_deleted_count?: number;
  delete_source?: 'manual' | 'automatic';
  last_error?: string;
  remaining_posts?: number;
};

type AdminDashboard = {
  controls?: { ranking_self_service_enabled?: boolean };
  cleanup?: { auto_delete_enabled?: boolean; inactivity_days?: number; grace_days?: number; updated_at?: string };
  post_cleanup?: { auto_delete_enabled?: boolean; retention_days?: number; updated_at?: string };
  users?: AdminUser[];
  posts?: AdminPost[];
  periods?: Array<{ id: number; status?: string }>;
  closed_periods?: ClosedPeriodCleanup[];
  logs?: AuditLog[];
};

const sections: AdminSection[] = ['Visão geral', 'Usuários', 'Publicações', 'Períodos fechados', 'Auditoria', 'Controles'];

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
  const [postCleanupEnabled, setPostCleanupEnabled] = useState(false);
  const [postRetentionDays, setPostRetentionDays] = useState(40);
  const [selectedClosedPeriods, setSelectedClosedPeriods] = useState<number[]>([]);

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
    setPostCleanupEnabled(Boolean(next.post_cleanup?.auto_delete_enabled));
    setPostRetentionDays(Number(next.post_cleanup?.retention_days || 40));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const users = dashboard.users || [];
  const posts = useMemo(()=>[...(dashboard.posts || [])].sort((a,b)=>(postPublishedDate(b)?.getTime()||0)-(postPublishedDate(a)?.getTime()||0)),[dashboard.posts]);
  const logs = dashboard.logs || [];
  const closedPeriods = dashboard.closed_periods || [];
  const normalizedSearch = search.trim().toLowerCase();
  const filteredUsers = useMemo(() => users.filter(user =>
    !normalizedSearch || [user.profile_name, user.username, user.display_name, user.email, user.x_handle]
      .some(value => String(value || '').toLowerCase().includes(normalizedSearch))
  ), [users, normalizedSearch]);
  const filteredPosts = useMemo(() => posts.filter(post =>
    !normalizedSearch || [post.title, post.author_handle, post.post_url]
      .some(value => String(value || '').toLowerCase().includes(normalizedSearch))
  ), [posts, normalizedSearch]);
  const filteredClosedPeriods = useMemo(() => closedPeriods.filter(period =>
    !normalizedSearch || [
      period.profile_name,
      period.username,
      period.display_name,
      period.email,
      period.period_start,
      period.period_end,
    ].some(value => String(value || '').toLowerCase().includes(normalizedSearch))
  ), [closedPeriods, normalizedSearch]);
  const selectableClosedPeriods = useMemo(() => filteredClosedPeriods.filter(period =>
    !period.posts_deleted_at && Number(period.remaining_posts || 0) > 0
  ), [filteredClosedPeriods]);
  const allVisibleClosedPeriodsSelected = selectableClosedPeriods.length > 0
    && selectableClosedPeriods.every(period => selectedClosedPeriods.includes(period.id));

  useEffect(() => {
    const available = new Set(closedPeriods
      .filter(period => !period.posts_deleted_at && Number(period.remaining_posts || 0) > 0)
      .map(period => period.id));
    setSelectedClosedPeriods(current => current.filter(id => available.has(id)));
  }, [closedPeriods]);

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

  async function savePostCleanup() {
    if (postRetentionDays < 1 || postRetentionDays > 3650) {
      setMessage('Escolha um prazo entre 1 e 3.650 dias.');
      return;
    }
    if (postCleanupEnabled && !window.confirm('Ativar o prazo padrão de ' + postRetentionDays + ' dia(s) para novos períodos fechados? Os períodos já fechados não serão alterados.')) return;
    await run('post-cleanup', () => supabase.rpc('admin_set_closed_period_post_cleanup', {
      p_enabled: postCleanupEnabled,
      p_retention_days: postRetentionDays,
    }), postCleanupEnabled ? 'Prazo padrão salvo para novos períodos fechados.' : 'Exclusão automática desativada para novos períodos.');
  }

  async function saveClosedPeriodSchedule(period: ClosedPeriodCleanup, enabled: boolean, days: number) {
    if (enabled && (days < 1 || days > 3650)) {
      setMessage('Escolha um prazo entre 1 e 3.650 dias.');
      return;
    }
    const reason = reasonFor(enabled ? 'agendar a exclusão das publicações deste período' : 'cancelar a exclusão automática deste período');
    if (!reason) return;
    if (enabled) {
      const deletionDate = new Date(new Date(period.closed_at).getTime() + days * 86400000);
      if (deletionDate.getTime() <= Date.now() && !window.confirm('Esse prazo já terminou. As publicações poderão ser excluídas na próxima execução automática. Deseja continuar?')) return;
    }
    await run('period-schedule-' + period.id, () => supabase.rpc('admin_schedule_closed_period_posts', {
      p_cleanup_id: period.id,
      p_enabled: enabled,
      p_retention_days: days,
      p_reason: reason,
    }), enabled ? 'Exclusão automática deste período agendada.' : 'Exclusão automática deste período cancelada.');
  }

  async function deleteClosedPeriodPosts(period: ClosedPeriodCleanup) {
    const remaining = Number(period.remaining_posts || 0);
    if (!remaining || period.posts_deleted_at) return;
    const profile = closedPeriodName(period);
    const warning = 'Excluir definitivamente ' + remaining + ' publicação(ões) de ' + profile + ', somente do período de ' + formatPeriodDate(period.period_start) + ' a ' + formatPeriodDate(period.period_end) + '? A conta e os outros períodos não serão alterados.';
    if (!window.confirm(warning)) return;
    const reason = reasonFor('excluir agora as publicações deste usuário e período fechado');
    if (!reason) return;
    setBusy('period-delete-' + period.id);
    setMessage('');
    try {
      const { data, error } = await supabase.rpc('admin_delete_closed_period_posts', {
        p_cleanup_id: period.id,
        p_reason: reason,
      });
      if (error) throw error;
      setMessage(Number(data || 0).toLocaleString('pt-BR') + ' publicação(ões) excluída(s) somente desse usuário e período.');
      await load();
    } catch (error:any) {
      setMessage(String(error?.message || 'Não foi possível excluir as publicações.'));
    } finally {
      setBusy('');
    }
  }

  async function deleteSelectedClosedPeriodPosts() {
    const periods = closedPeriods.filter(period => selectedClosedPeriods.includes(period.id) && !period.posts_deleted_at && Number(period.remaining_posts || 0) > 0);
    if (!periods.length) return;
    const totalPosts = periods.reduce((total, period) => total + Number(period.remaining_posts || 0), 0);
    const warning = 'Excluir definitivamente ' + totalPosts.toLocaleString('pt-BR') + ' publicação(ões) de ' + periods.length + ' período(s) fechado(s)? As contas, os outros períodos e o ranking arquivado não serão alterados.';
    if (!window.confirm(warning)) return;
    const reason = reasonFor('excluir as publicações dos períodos fechados selecionados');
    if (!reason) return;
    setBusy('period-delete-selected');
    setMessage('');
    try {
      const { data, error } = await supabase.rpc('admin_delete_closed_period_posts_bulk', {
        p_cleanup_ids: periods.map(period => period.id),
        p_reason: reason,
      });
      if (error) throw error;
      const result = (data || {}) as { periods?: number; posts?: number };
      setSelectedClosedPeriods([]);
      setMessage(Number(result.posts || 0).toLocaleString('pt-BR') + ' publicação(ões) excluída(s) de ' + Number(result.periods || 0).toLocaleString('pt-BR') + ' período(s).');
      await load();
    } catch (error:any) {
      setMessage(String(error?.message || 'Não foi possível excluir as publicações selecionadas.'));
    } finally {
      setBusy('');
    }
  }

  const suspendedCount = users.filter(user => user.suspended).length;
  const blockedCount = users.filter(user => user.ranking_blocked).length;
  const reviewedCount = posts.filter(post => post.admin_eligible === false).length;
  const scheduledCount = users.filter(user => user.deletion_scheduled_at).length;
  const scheduledPeriodCount = closedPeriods.filter(period => period.delete_after && !period.posts_deleted_at).length;

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
      <AdminStat label="EXCLUSÕES AGENDADAS" value={scheduledCount + scheduledPeriodCount} detail={scheduledPeriodCount + ' período(s) fechado(s)'}/>
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
        <div className="admin-control-row">
          <div><strong>Publicações de períodos fechados</strong><p>{postCleanupEnabled ? 'Novos fechamentos: exclusão após ' + postRetentionDays + ' dia(s).' : 'A exclusão automática está desativada.'}</p></div>
          <button className="admin-outline" onClick={() => setSection('Períodos fechados')}>GERENCIAR</button>
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
          <div className="admin-user-identity"><i>{String(user.profile_name || user.username || user.display_name || user.email || '?').slice(0, 1).toUpperCase()}</i><div><strong>{user.profile_name || user.username || user.display_name || user.x_handle || 'Sem nome'}</strong>{user.is_admin && <em>ADMINISTRADOR</em>}</div></div>
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

    {section === 'Períodos fechados' && <div className="admin-panel">
      <PanelHeading eyebrow="RETENÇÃO DE PUBLICAÇÕES" title="Períodos fechados" search={search} setSearch={setSearch}/>
      <p className="admin-panel-copy admin-period-copy">O prazo começa na data do fechamento. Somente as publicações do usuário e do intervalo selecionado podem ser excluídas.</p>
      <div className="admin-period-selection">
        <label><input
          type="checkbox"
          checked={allVisibleClosedPeriodsSelected}
          disabled={!selectableClosedPeriods.length || busy === 'period-delete-selected'}
          onChange={event => {
            const visibleIds = selectableClosedPeriods.map(period => period.id);
            setSelectedClosedPeriods(current => event.target.checked
              ? Array.from(new Set([...current, ...visibleIds]))
              : current.filter(id => !visibleIds.includes(id)));
          }}
        /><span>Selecionar todos os períodos exibidos</span></label>
        <strong>{selectedClosedPeriods.length.toLocaleString('pt-BR')} SELECIONADO(S)</strong>
        <button type="button" className="danger" disabled={!selectedClosedPeriods.length || busy === 'period-delete-selected'} onClick={deleteSelectedClosedPeriodPosts}>{busy === 'period-delete-selected' ? 'EXCLUINDO...' : 'EXCLUIR SELECIONADOS'}</button>
      </div>
      <div className="admin-closed-periods">
        {filteredClosedPeriods.map(period => <ClosedPeriodRow
          key={period.id}
          period={period}
          busy={busy}
          selected={selectedClosedPeriods.includes(period.id)}
          onSelectedChange={selected => setSelectedClosedPeriods(current => selected ? Array.from(new Set([...current, period.id])) : current.filter(id => id !== period.id))}
          onSave={saveClosedPeriodSchedule}
          onDelete={deleteClosedPeriodPosts}
        />)}
        {!filteredClosedPeriods.length && <div className="admin-empty">Nenhum período fechado encontrado.</div>}
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
      <div className="admin-panel">
        <div className="admin-panel-head"><div><small>PERÍODOS FECHADOS</small><h2>Prazo padrão das publicações</h2></div><StatusTag tone={postCleanupEnabled ? 'warning' : 'neutral'}>{postCleanupEnabled ? 'CONFIGURADO' : 'DESATIVADO'}</StatusTag></div>
        <div className="admin-form">
          <label className="admin-check"><span><strong>Ativar para novos fechamentos</strong><small>O prazo começa somente quando o período é fechado.</small></span><input type="checkbox" checked={postCleanupEnabled} onChange={event => setPostCleanupEnabled(event.target.checked)}/></label>
          <label><span>Excluir publicações depois de quantos dias?</span><input type="number" min="1" max="3650" value={postRetentionDays} onChange={event => setPostRetentionDays(Number(event.target.value))}/></label>
          <p className="admin-form-note">Essa configuração vale para os próximos fechamentos. Períodos já fechados podem ser ajustados individualmente na aba “Períodos fechados”.</p>
          <button className="admin-primary" disabled={busy === 'post-cleanup'} onClick={savePostCleanup}>SALVAR PRAZO DAS PUBLICAÇÕES</button>
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

function ClosedPeriodRow({period,busy,selected,onSelectedChange,onSave,onDelete}:{
  period:ClosedPeriodCleanup;
  busy:string;
  selected:boolean;
  onSelectedChange:(selected:boolean)=>void;
  onSave:(period:ClosedPeriodCleanup,enabled:boolean,days:number)=>Promise<void>;
  onDelete:(period:ClosedPeriodCleanup)=>Promise<void>;
}) {
  const [enabled,setEnabled] = useState(Boolean(period.delete_after));
  const [days,setDays] = useState(Number(period.retention_days || 40));
  useEffect(() => {
    setEnabled(Boolean(period.delete_after));
    setDays(Number(period.retention_days || 40));
  }, [period.delete_after,period.retention_days]);
  const deleted = Boolean(period.posts_deleted_at);
  const remaining = Number(period.remaining_posts || 0);
  const statusTone = deleted ? 'neutral' : period.last_error ? 'danger' : period.delete_after ? 'warning' : 'success';
  const status = deleted ? 'EXCLUÍDAS' : period.last_error ? 'ERRO' : period.delete_after ? 'AGENDADA' : 'MANUAL';
  const scheduleBusy = busy === 'period-schedule-' + period.id;
  const deleteBusy = busy === 'period-delete-' + period.id;
  return <article className="admin-closed-period-card">
    <div className="admin-closed-period-main">
      <label className="admin-period-select" title={remaining && !deleted ? 'Selecionar este período' : 'Não há publicações para excluir'}><input type="checkbox" checked={selected} disabled={!remaining || deleted || busy === 'period-delete-selected'} onChange={event => onSelectedChange(event.target.checked)}/></label>
      <div className="admin-closed-period-title">
        <i>{closedPeriodName(period).slice(0,1).toUpperCase()}</i>
        <div><strong>{closedPeriodName(period)}</strong><small>{formatPeriodDate(period.period_start)} até {formatPeriodDate(period.period_end)}</small></div>
      </div>
      <div className="admin-closed-period-facts">
        <span><small>FECHADO EM</small><strong>{formatDate(period.closed_at,true)}</strong></span>
        <span><small>PUBLICAÇÕES ATUAIS</small><strong>{remaining.toLocaleString('pt-BR')}</strong></span>
        <span><small>EXCLUSÃO</small><strong>{period.delete_after ? formatDate(period.delete_after,true) : 'Sem prazo'}</strong></span>
      </div>
      <StatusTag tone={statusTone}>{status}</StatusTag>
    </div>
    {period.last_error && <p className="admin-period-error">Última tentativa: {period.last_error}</p>}
    {deleted ? <div className="admin-period-deleted">Exclusão {period.delete_source === 'automatic' ? 'automática' : 'manual'} concluída em {formatDate(period.posts_deleted_at,true)} · {Number(period.posts_deleted_count || 0).toLocaleString('pt-BR')} publicação(ões).</div> : <div className="admin-closed-period-actions">
      <label className="admin-period-check"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}/><span>Exclusão automática</span></label>
      <label className="admin-period-days"><span>Dias após o fechamento</span><input type="number" min="1" max="3650" value={days} disabled={!enabled} onChange={event => setDays(Number(event.target.value))}/></label>
      <button type="button" disabled={scheduleBusy} onClick={() => onSave(period,enabled,days)}>{scheduleBusy ? 'SALVANDO...' : 'SALVAR PRAZO'}</button>
      <button type="button" className="danger" disabled={!remaining || deleteBusy} onClick={() => onDelete(period)}>{deleteBusy ? 'EXCLUINDO...' : 'EXCLUIR PUBLICAÇÕES AGORA'}</button>
    </div>}
  </article>;
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
    configure_closed_period_post_cleanup:'Prazo padrão de publicações configurado',
    schedule_closed_period_post_cleanup:'Exclusão de período agendada',
    cancel_closed_period_post_cleanup:'Exclusão de período cancelada',
    delete_closed_period_posts:'Publicações do período excluídas',
  };
  return labels[action] || action.replaceAll('_', ' ');
}

function formatDate(value?:string, withTime=false) {
  if (!value) return 'Sem registro';
  return formatPostDate(value, withTime) || 'Sem registro';
}

function closedPeriodName(period:ClosedPeriodCleanup) {
  return period.profile_name || period.username || period.display_name || period.email || 'Usuário sem nome';
}

function formatPeriodDate(value?:string) {
  if (!value) return 'Sem data';
  const [year,month,day] = value.slice(0,10).split('-');
  return year && month && day ? day + '/' + month + '/' + year : value;
}

