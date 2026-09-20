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
  window.__safetyRequests = [];
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url || String(input), location.href);
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
    return new Response(JSON.stringify(data), {status: 200, headers: {'Content-Type': 'application/json'}});
  };
})();
