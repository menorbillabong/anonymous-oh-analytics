import test from 'node:test';
import assert from 'node:assert/strict';
import {MATRIX_DEFAULTS, normalizeMatrixAppearance, matrixRenderBudget} from '../lib/matrix-appearance.ts';

test('Matrix is on and green for old settings and new accounts', () => {
  for (const input of [undefined, null, {}]) assert.deepEqual(normalizeMatrixAppearance(input), MATRIX_DEFAULTS);
});
test('Matrix preserves explicit off and validates custom and preset colors', () => {
  assert.deepEqual(normalizeMatrixAppearance({matrix_enabled:false,matrix_color:'#AABBCC'}), {matrix_enabled:false,matrix_color:'#aabbcc'});
  for (const color of ['#3de879','#b189ff','#f9ad3e','#123456']) assert.equal(normalizeMatrixAppearance({matrix_color:color}).matrix_color,color);
  for (const color of ['red','#123','url(example)',null,1,'#1234567']) assert.equal(normalizeMatrixAppearance({matrix_color:color}).matrix_color,MATRIX_DEFAULTS.matrix_color);
  for (const value of ['false',0,null]) assert.equal(normalizeMatrixAppearance({matrix_enabled:value}).matrix_enabled,true);
});
test('Matrix rendering is capped on mobile and large screens', () => {
  const mobile=matrixRenderBudget(390,844,3), desktop=matrixRenderBudget(3840,2160,3);
  assert.equal(mobile.pixelRatio,1); assert.ok(mobile.columns<=24); assert.equal(mobile.frameInterval,62.5);
  assert.equal(desktop.pixelRatio,1.5); assert.equal(desktop.columns,80); assert.equal(desktop.trail,20);
});
