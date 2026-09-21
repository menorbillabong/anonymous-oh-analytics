import test from 'node:test';
import assert from 'node:assert/strict';
import {accountNeedsReview,adminUserDisplayName,sortUsersByDisplayName,normalizeUserSearch,userMatchesSearch} from '../lib/admin-user-search.ts';

test('busca nomes com e sem acentos, maiúsculas e espaços repetidos',()=>{
  assert.equal(normalizeUserSearch('  JOÃO   Ávila '),'joao avila');
  assert.equal(userMatchesSearch({profile_name:'João Ávila'},'  joao avila '),true);
  assert.equal(userMatchesSearch({profile_name:'João Ávila'},'ávila joão'),true);
  assert.equal(userMatchesSearch({profile_name:'Lunytta'},'LUNY'),true);
});
test('preserva pesquisa por usuário, e-mail e perfil X',()=>{
  const user={username:'luna',display_name:'Lu',email:'luna@example.test',x_handle:'Luna_X'};
  for(const query of ['luna','LU','@example.test','luna_x'])assert.equal(userMatchesSearch(user,query),true);
  assert.equal(userMatchesSearch(user,'outra'),false);
  assert.equal(userMatchesSearch(user,'luna inexistente'),false);
});
test('busca vazia mostra todos e dados ausentes não causam erro',()=>{
  assert.equal(userMatchesSearch({},' '),true);
  assert.equal(userMatchesSearch({},'nome'),false);
  assert.equal(normalizeUserSearch(null),'');
});

test('review includes the exact inactivity threshold but protects administrators and missing data',()=>{
  assert.equal(accountNeedsReview({inactive_days:30},30),true);
  assert.equal(accountNeedsReview({inactive_days:29},30),false);
  assert.equal(accountNeedsReview({inactive_days:90,is_admin:true},30),false);
  assert.equal(accountNeedsReview({},30),false);
  assert.equal(accountNeedsReview({inactive_days:NaN},30),false);
});
test('review list combines name search with eligibility without changing the all-accounts list',()=>{
  const users=[{profile_name:'João',inactive_days:60},{profile_name:'Maria',inactive_days:5},{profile_name:'Admin',inactive_days:100,is_admin:true}];
  const reviewed=users.filter(user=>accountNeedsReview(user,30));
  assert.equal(reviewed.length,1);
  assert.equal(reviewed.filter(user=>userMatchesSearch(user,'joao')).length,1);
  assert.equal(reviewed.filter(user=>userMatchesSearch(user,'maria')).length,0);
  assert.equal(users.length,3);
  assert.equal(users.filter(user=>accountNeedsReview(user,90)).length,0);
});

test('sorts by the displayed name, ignoring accents and case without mutating the source',()=>{
  const users=Object.freeze([{profile_name:'zélia'},{profile_name:'Bruno'},{profile_name:'Álvaro'},{profile_name:'ana'}]);
  assert.deepEqual(sortUsersByDisplayName(users).map(adminUserDisplayName),['Álvaro','ana','Bruno','zélia']);
  assert.equal(users[0].profile_name,'zélia');
});
test('name fallbacks and numeric suffixes use the same order in both account tabs and search',()=>{
  const users=[{profile_name:'Zoe',username:'aaa',inactive_days:60},{username:'Pessoa 10',inactive_days:90},{display_name:'pessoa 2',inactive_days:90},{x_handle:'Ana',inactive_days:0},{}];
  const sorted=sortUsersByDisplayName(users);
  assert.deepEqual(sorted.map(adminUserDisplayName),['Ana','pessoa 2','Pessoa 10','Sem nome','Zoe']);
  assert.deepEqual(sorted.filter(user=>accountNeedsReview(user,30)).map(adminUserDisplayName),['pessoa 2','Pessoa 10','Zoe']);
  assert.deepEqual(sorted.filter(user=>userMatchesSearch(user,'pessoa')).map(adminUserDisplayName),['pessoa 2','Pessoa 10']);
  assert.deepEqual(sortUsersByDisplayName([]),[]);
});
