import test from 'node:test';
import assert from 'node:assert/strict';
import {withoutExistingXPosts,xStatusId} from '../lib/x-post-dedupe.ts';

test('identifica o mesmo post em formatos diferentes de link do X',()=>{
 assert.equal(xStatusId('https://x.com/perfil/status/123456?s=20'),'123456');
 assert.equal(xStatusId('https://twitter.com/outro/status/123456/photo/1'),'123456');
});

test('oculta posts existentes e repetidos dentro da própria busca',()=>{
 const items=[
  {url:'https://x.com/a/status/111'},
  {url:'https://twitter.com/b/status/222?s=20'},
  {url:'https://x.com/c/status/222/photo/1'},
  {url:'https://x.com/d/status/333'},
 ];
 const result=withoutExistingXPosts(items,['https://twitter.com/antigo/status/111'],item=>item.url);
 assert.deepEqual(result.accepted.map(item=>xStatusId(item.url)),['222','333']);
 assert.equal(result.hiddenDuplicateCount,2);
});
