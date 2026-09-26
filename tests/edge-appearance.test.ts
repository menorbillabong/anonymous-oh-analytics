import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEdgeAppearance,contrastingText,buttonAppearanceCss,BUTTON_APPEARANCE} from '../lib/edge-appearance.ts';
import {portableSettings} from '../lib/settings-preset.ts';

test('old accounts preserve defaults; zero is not replaced by default',()=>{
 assert.deepEqual(normalizeEdgeAppearance(null),{border_glow_intensity:50,button_colors:{}});
 assert.equal(normalizeEdgeAppearance({border_glow_intensity:0}).border_glow_intensity,0);
 assert.equal(normalizeEdgeAppearance({border_glow_intensity:1000}).border_glow_intensity,100);
 assert.equal(normalizeEdgeAppearance({border_glow_intensity:NaN}).border_glow_intensity,50);
});
test('color normalization accepts only named buttons and hex colors',()=>{
 assert.deepEqual(normalizeEdgeAppearance({button_colors:{x:'#AABBCC',bulk:'red',unknown:'#000000',report:'</style>'}}).button_colors,{x:'#aabbcc'});
 assert.equal(buttonAppearanceCss({}), '');
 assert.equal(buttonAppearanceCss({x:'url(evil)'}),'');
 assert.match(buttonAppearanceCss({x:'#000000'}),/color:#ffffff/);
});
test('text contrast always selects the higher contrast black or white',()=>{
 assert.equal(contrastingText('#ffffff'),'#000000');assert.equal(contrastingText('#000000'),'#ffffff');
 for(const {color} of BUTTON_APPEARANCE)assert.ok(['#000000','#ffffff'].includes(contrastingText(color)));
});
test('preset round trip preserves appearance, validates bounds and never imports unknown CSS',()=>{
 const value={border_glow_intensity:0,button_colors:{metrics:'#9257da',sheets:'#123456'}};
 assert.deepEqual(portableSettings(value),value);
 assert.deepEqual(portableSettings({accent_color:'#abcdef'}),{accent_color:'#abcdef'});
 for(const border_glow_intensity of [-1,101,NaN,1.5,'30',null])assert.throws(()=>portableSettings({border_glow_intensity}));
 for(const button_colors of [null,[],{x:'red'},{metrics:5},{unknown:'#ffffff'}])assert.throws(()=>portableSettings({button_colors}));
});
