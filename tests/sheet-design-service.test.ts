import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {SHEET_DESIGNS} from '../lib/sheet-designs.ts';

const compiled=ts.transpileModule(readFileSync(new URL('../lib/sheet-design-service.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function service(title:string,id:number,rows=100){
  const calls:string[]=[];
  const target={properties:{title,sheetId:id,gridProperties:{rowCount:rows,columnCount:19}},data:[]};
  const dependencies:Record<string,unknown>={
    'server-only':{},'node:crypto':{},'./sheet-designs':{},'./sheet-design-plan':{},'./sheet-design-blueprints.json':{},'./sheet-native-snapshot':{},
    './google-sheets':{SHEETS_API:'https://sheets.example.test',accessToken:async()=> 'fixture',googleRequest:async(url:string,_token:string,init?:RequestInit)=>{assert.equal(init?.method,undefined,'reading the registered tab never writes');calls.push(url);return{sheets:[target]}}},
  };
  const module={exports:{} as {readRegisteredSheet:(tab:string)=>Promise<{target:typeof target}>}};
  new Function('require','module','exports','process',compiled)((name:string)=>{assert.ok(name in dependencies);return dependencies[name]},module,module.exports,{env:{GOOGLE_SHEETS_SPREADSHEET_ID:'1YuHQY_FFRjbz1M-pd3LswkcUyEBbA531jKyd579IVKA'}});
  return{read:module.exports.readRegisteredSheet,calls,target};
}

for(const design of SHEET_DESIGNS)test(`registered former source ${design.tab} can be read for backup and design preview`,async()=>{
  const s=service(design.tab,design.sheetId);
  assert.deepEqual((await s.read(design.tab)).target,s.target);
  assert.equal(s.calls.length,2);
  assert.ok(s.calls[1].includes(encodeURIComponent(`'${design.tab}'!A1:S100`)));
});
test('registered tab lookup does not fall back to another tab',async()=>{
  const s=service('DESIGN 2',14436827);
  await assert.rejects(()=>s.read('Other tab'),/aba vinculada/);
  assert.equal(s.calls.length,1);
});
test('legacy backup tab and size protection remain enforced',async()=>{
  await assert.rejects(()=>service('Backup AOH fixture',1).read('Backup AOH fixture'),/cópia de segurança/);
  await assert.rejects(()=>service('Own tab',2,2001).read('Own tab'),/tamanho suportado/);
});
