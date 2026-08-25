import assert from 'node:assert/strict';
import test from 'node:test';
import {buildPostsCsv} from '../lib/csv-export.ts';

test('exports current publications grouped by mission and ordered by X date',()=>{
 const csv=buildPostsCsv([
  {mission_name:'Vídeos',post_url:'https://x.com/test/status/2',x_published_at:'2026-08-04T12:00:00Z',views:20,likes:3},
  {mission_name:'Fotos',post_url:'https://x.com/test/status/3',x_published_at:'2026-08-05T12:00:00Z',views:30,likes:4},
  {mission_name:'Vídeos',post_url:'https://x.com/test/status/1',x_published_at:'2026-08-03T12:00:00Z',views:10,likes:2},
 ]);

 assert.match(csv,/"MISSÃO: Vídeos"/);
 assert.match(csv,/"MISSÃO: Fotos"/);
 assert.ok(csv.indexOf('status/1')<csv.indexOf('status/2'));
 assert.match(csv,/"03\/08\/2026","X","https:\/\/x\.com\/test\/status\/1","10","2"/);
});

test('escapes mission names and links without corrupting the CSV',()=>{
 const csv=buildPostsCsv([
  {mission_name:'Fotos, "High Quality"',post_url:'https://x.com/test/status/1?name="teste"',published_at:'2026-08-03',views:'inválido',likes:null},
 ]);

 assert.match(csv,/"MISSÃO: Fotos, ""High Quality"""/);
 assert.match(csv,/"https:\/\/x\.com\/test\/status\/1\?name=""teste"""/);
 assert.match(csv,/,"0","0"\r\n$/);
});

test('does not create content when there are no publications',()=>{
 assert.equal(buildPostsCsv([]),'');
});

