import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUserSearch,userMatchesSearch} from '../lib/admin-user-search.ts';

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
