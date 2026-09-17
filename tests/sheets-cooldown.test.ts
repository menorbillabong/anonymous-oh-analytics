import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cooldownFromFields,formatCooldown} from '../lib/sheets-cooldown.ts';
import {translateUiText} from '../lib/i18n.ts';

test('cooldown accepts minutes and seconds including boundaries',()=>{
  assert.equal(cooldownFromFields('1','30'),90);
  assert.equal(cooldownFromFields('0','1'),1);
  assert.equal(cooldownFromFields('1440','0'),86400);
});
test('cooldown rejects missing, fractional, negative and out-of-range fields',()=>{
  for(const [m,s] of [['','30'],['1',''],['0','0'],['-1','30'],['1.5','0'],['1','60'],['1440','1'],['NaN','0'],['1e2','0'],['0','Infinity']])assert.equal(cooldownFromFields(m,s),null,`${m}:${s}`);
});
test('countdown displays seconds accurately rather than rounding to minutes',()=>{
  assert.equal(formatCooldown(90),'1:30');assert.equal(formatCooldown(1),'0:01');
  assert.equal(formatCooldown(0),'0:00');assert.equal(formatCooldown(59.5),'1:00');
  assert.equal(formatCooldown(-5),'0:00');assert.equal(formatCooldown(NaN),'0:00');
});
test('countdown and global settings translate to English and Spanish',()=>{
  assert.equal(translateUiText('PLANILHA · 1:30','es'),'PLANILLA · 1:30');
  assert.equal(translateUiText('Disponível novamente em 0:05','en'),'Available again in 0:05');
  assert.equal(translateUiText('Aguarde 1:30 para atualizar novamente.','es'),'Espera 1:30 para actualizar nuevamente.');
  assert.equal(translateUiText('SALVAR TEMPO DE ESPERA','en'),'SAVE COOLDOWN');
});
