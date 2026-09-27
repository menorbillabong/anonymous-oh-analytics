export const SHEET_DESIGNS = [
  {id:'design-1',title:'Design 1',description:'Rosa e vinho',color:'#a64d79',sheetId:1418793802,tab:'DESIGN 1'},
  {id:'design-2',title:'Design 2',description:'Escuro e cinza',color:'#484848',sheetId:14436827,tab:'DESIGN 2'},
  {id:'design-3',title:'Design 3',description:'Rosa e azul claro',color:'#e3adc9',sheetId:1191890062,tab:'DESIGN 3'},
  {id:'design-4',title:'Design 4',description:'Azul, branco e amarelo',color:'#225478',sheetId:1141541069,tab:'DESIGNE 4'},
] as const;
export type SheetDesignId = typeof SHEET_DESIGNS[number]['id'];
export function sheetDesign(id:unknown){return SHEET_DESIGNS.find(item=>item.id===id)}
