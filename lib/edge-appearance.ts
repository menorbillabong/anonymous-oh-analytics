export const BUTTON_APPEARANCE = [
  {id:'x', label:'Buscar no X', color:'#f6ad55'},
  {id:'bulk', label:'Adição em massa', color:'#f6ad55'},
  {id:'add', label:'Adicionar publicação', color:'#f6ad55'},
  {id:'metrics', label:'Atualizar métricas', color:'#24d9a5'},
  {id:'sheets', label:'Atualizar planilha', color:'#72b6ff'},
  {id:'missions', label:'Períodos de missão', color:'#69abff'},
  {id:'report', label:'Relatório', color:'#f6ad55'},
  {id:'open', label:'Abrir período / corrigir início', color:'#69abff'},
  {id:'close', label:'Fechar período', color:'#69abff'},
  {id:'txt', label:'Exportar TXT', color:'#8d9099'},
  {id:'csv', label:'Exportar CSV', color:'#8d9099'},
] as const;
export type ButtonAppearanceId = typeof BUTTON_APPEARANCE[number]['id'];
export type ButtonColors = Partial<Record<ButtonAppearanceId,string>>;
export type EdgeAppearance = {border_glow_intensity:number; button_colors:ButtonColors};
// 50 preserves the existing glow; no button overrides preserves the current palette.
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
  return BUTTON_APPEARANCE.filter(({id})=>isHexColor(colors[id])).map(({id})=>{
    const color=colors[id]!;
    return `html body .exact-app .hero-actions button[data-appearance-button][data-appearance-button="${id}"]{background:${color}!important;border-color:${color}!important;color:${contrastingText(color)}!important;--own-color-glow:${color}!important;}`;
  }).join('\n');
}
