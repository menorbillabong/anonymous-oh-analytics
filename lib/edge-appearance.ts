export const BUTTON_APPEARANCE = [
  {id:'x', label:'Buscar no X', color:'#ffa97a'},
  {id:'bulk', label:'Adição em massa', color:'#ffa97a'},
  {id:'add', label:'Adicionar publicação', color:'#ffa97a'},
  {id:'metrics', label:'Atualizar métricas', color:'#29dba8'},
  {id:'sheets', label:'Atualizar planilha', color:'#29dba8'},
  {id:'missions', label:'Períodos de missão', color:'#650094'},
  {id:'report', label:'Relatório', color:'#650094'},
  {id:'open', label:'Abrir período / corrigir início', color:'#352d71'},
  {id:'close', label:'Fechar período', color:'#352d71'},
  {id:'txt', label:'Exportar TXT', color:'#858993'},
  {id:'csv', label:'Exportar CSV', color:'#858993'},
] as const;
export type ButtonAppearanceId = typeof BUTTON_APPEARANCE[number]['id'];
export type ButtonColors = Partial<Record<ButtonAppearanceId,string>>;
export type EdgeAppearance = {border_glow_intensity:number; button_colors:ButtonColors};
// Snapshot approved on 2026-09-26; personal overrides remain independent afterward.
export const THEME_COLOR_DEFAULTS = {accent_color:'#ffb042',background_color:'#000000',surface_color:'#000000',border_color:'#ff00c8'};
// Glow intensity is unchanged. Empty overrides now resolve to BUTTON_APPEARANCE.
export const EDGE_APPEARANCE_DEFAULTS:EdgeAppearance = {border_glow_intensity:50,button_colors:{}};
export function isHexColor(value:unknown):value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}
export function normalizeEdgeAppearance(value:{border_glow_intensity?:unknown;button_colors?:unknown}|null|undefined):EdgeAppearance {
  const intensity=value?.border_glow_intensity;
  const colors=value?.button_colors;
  const button_colors:ButtonColors={};
  if(colors && typeof colors==='object' && !Array.isArray(colors)) {
    for(const {id} of BUTTON_APPEARANCE){
      const color=(colors as Record<string,unknown>)[id];
      if(isHexColor(color))button_colors[id]=color.toLowerCase();
    }
  }
  return {border_glow_intensity:typeof intensity==='number'&&Number.isFinite(intensity)?Math.round(Math.max(0,Math.min(100,intensity))):50,button_colors};
}
export function contrastingText(color:string) {
  const hex=isHexColor(color)?color:'#f6ad55';
  const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  const luminance=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  return (luminance+.05)/.05 >= 1.05/(luminance+.05)?'#000000':'#ffffff';
}
export function buttonAppearanceCss(colors:ButtonColors) {
  // Whitelisted identifiers and six-digit colors only; no arbitrary CSS from storage.
  return BUTTON_APPEARANCE.map(({id,color:defaultColor})=>{
    const color=isHexColor(colors[id])?colors[id]!:defaultColor;
    return `html body .exact-app .hero-actions button[data-appearance-button][data-appearance-button="${id}"]{background:${color}!important;border-color:${color}!important;color:${contrastingText(color)}!important;--own-color-glow:${color}!important;}`;
  }).join('\n');
}
