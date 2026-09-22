// Browser-only local fixture. Never use on a deployed website or with real credentials.
(() => {
  if (location.hostname !== '127.0.0.1' || location.port !== '3107') return;
  const admin = '11111111-1111-4111-8111-111111111111';
  const inactive = '22222222-2222-4222-8222-222222222222';
  const active = '33333333-3333-4333-8333-333333333333';
  const old = '2025-01-01T00:00:00.000Z';
  const backupId = '44444444-4444-4444-8444-444444444444';
  const payload = btoa(JSON.stringify({sub: admin, role: 'authenticated', exp: 4102444800}));
  localStorage.setItem('sb-127-auth-token', JSON.stringify({
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test-signature`, refresh_token: 'local-test-only',
    expires_at: 4102444800, expires_in: 3600, token_type: 'bearer',
    user: {id: admin, email: 'admin@example.invalid', user_metadata: {username: 'Admin teste'}, app_metadata: {}, aud: 'authenticated'},
  }));
  const users = [
    {id: admin, email: 'admin@example.invalid', profile_name: 'Administrador de teste', is_admin: true, inactive_days: 0, last_activity_at: new Date().toISOString()},
    {id: inactive, email: 'inactive@example.invalid', profile_name: 'Conta inativa de teste', inactive_days: 90, last_activity_at: old},
    {id: active, email: 'active@example.invalid', profile_name: 'Conta ativa de teste', inactive_days: 0, last_activity_at: new Date().toISOString()},
  ];
  const original = window.fetch.bind(window);
  const mobileLayout = new URLSearchParams(location.search).has('mobile-layout');
  const profiles = [
    {id: 1, user_id: admin, name: 'Publicações regulares', active: true, color: '#54c27a', reward: 0},
    {id: 2, user_id: admin, name: 'Missão especial de fotografias', active: true, color: '#f6ad55', reward: 200},
  ];
  const posts = [1, 2].map(id => ({id, user_id: admin, post_url: `https://x.com/test_fixture/status/${id}`, title: `Publicação fictícia ${id} para conferir o layout no celular`, author_name: 'Perfil de teste', author_handle: 'test_fixture', published_at: '2026-09-12T15:00:00Z', published_date: '2026-09-12', created_at: '2026-09-12T15:00:00Z', views: 1200, likes: 45, comments: 3, reposts: 7, mission_profile_id: 1, special_reward: 0, image_urls: []}));
  window.__safetyRequests = [];
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url || String(input), location.href);
    // Keep preview hydration local too: no X requests during layout checks.
    if (mobileLayout && url.origin === location.origin && url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify(url.pathname === '/api/x-metrics' ? posts[0] : {}), {status: 200, headers: {'Content-Type': 'application/json'}});
    }
    if (url.origin !== 'http://127.0.0.1:54321') return original(input, init);
    const rpc = url.pathname.split('/').pop();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    window.__safetyRequests.push({rpc, body});
    let data = [];
    if (rpc === 'admin_users') data = {user_id: admin};
    if (rpc === 'user_settings') data = {user_id: admin, app_name: 'Teste isolado', dashboard_layout: 'modern'};
    if (rpc === 'get_my_active_period') data = null;
    if (rpc === 'get_my_manual_like_adjustment') data = {allowed: false, enabled: false, amount: 0};
    if (rpc === 'record_account_activity') data = new Date().toISOString();
    if (rpc === 'admin_dashboard') data = {cleanup: {auto_delete_enabled: false, inactivity_days: 30, grace_days: 5}, controls: {}, users, posts: [], closed_periods: [], logs: []};
    if (rpc === 'admin_preview_account_review') data = {user_id: body.p_target_user, email: 'inactive@example.invalid', can_delete: body.p_target_user === inactive, last_activity_at: old, posts: 2, archives: 1};
    if (rpc === 'admin_delete_reviewed_account') data = {deleted: true, backup_id: backupId};
    if (rpc === 'admin_account_backups') data = body.p_backup_id ? {id: backupId, snapshot: {test: true}} : [{id: backupId, email: 'previous-test@example.invalid', created_at: old}];
    if (rpc === 'admin_set_account_cleanup') data = {auto_delete_enabled: false, inactivity_days: body.p_inactivity_days};
    if (mobileLayout) {
      if (rpc === 'user') data = {id: admin, email: 'admin@example.invalid', user_metadata: {username: 'Admin teste'}, app_metadata: {}, aud: 'authenticated'};
      if (rpc === 'user_settings') data = {user_id: admin, app_name: 'Teste celular', profile_name_confirmed: true, panel_action_layout: 'organized', monthly_post_goal: 60, show_refresh_timer: true, refresh_interval: .5, next_refresh_at: new Date(Date.now() + 1800000).toISOString()};
      if (rpc === 'posts') data = Number(url.searchParams.get('offset') || 0) > 0 ? [] : posts;
      if (rpc === 'mission_profiles') data = profiles;
      if (rpc === 'get_my_active_period') data = {id: '55555555-5555-4555-8555-555555555555', start_date: '2026-09-01', can_close: false, close_available_on: '2026-10-01'};
      if (rpc === 'get_my_x_import_access') data = {enabled: true, handle: 'test_fixture'};
      if (rpc === 'get_my_google_sheets_sync_status') data = {enabled: true, retry_after_seconds: 0};
      if (rpc === 'get_my_manual_like_adjustment') data = {allowed: true, enabled: false, amount: 0};
      if (rpc === 'google_sheets_user_config') data = {enabled: true, sheet_tab_name: 'Teste', sheet_month: '2026-09'};
      if (rpc === 'mission_selection_periods') data = [{id: '66666666-6666-4666-8666-666666666666', start_date: '2026-09-10', end_date: '2026-09-15', per_user_limit: 2, revision: 1}];
      if (rpc === 'monthly_rankings') data = [{user_id: admin, x_handle: 'perfil_de_teste', month: '2026-09-01', posts_count: 2, total_views: 2400, likes: 90, crystalgin: 180, published: true}];
      if (rpc === 'archived_periods') data = [{id: 1, period_start: '2026-08-01', period_end: '2026-08-31', expires_at: '2026-10-10T15:00:00Z', summary: {total: 180, posts: 2, views: 2400, likes: 90}}];
      if (rpc === 'activity_logs') data = [{id: 1, action: 'Publicação adicionada', description: 'Registro fictício para verificar a quebra de texto no celular.', created_at: '2026-09-12T15:00:00Z'}];
    }
    return new Response(JSON.stringify(data), {status: 200, headers: {'Content-Type': 'application/json'}});
  };
})();
