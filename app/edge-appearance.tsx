'use client';

import {useEffect,useState,type CSSProperties} from 'react';
import {BUTTON_APPEARANCE,EDGE_APPEARANCE_DEFAULTS,buttonAppearanceCss,contrastingText,isHexColor,normalizeEdgeAppearance,type ButtonAppearanceId,type EdgeAppearance} from '@/lib/edge-appearance';
import styles from './edge-appearance.module.css';
import {PwaInstall} from './pwa';

export function useEdgeAppearance(settings:EdgeAppearance,userId:string) {
  const {border_glow_intensity:intensity,button_colors:colors}=normalizeEdgeAppearance(settings);
  const css=buttonAppearanceCss(colors);
  useEffect(()=>{
    const root=document.documentElement;
    const scale=intensity/50;
    root.style.setProperty('--edge-glow-line',`${scale}px`);
    root.style.setProperty('--edge-glow-radius',`${12*scale}px`);
    root.style.setProperty('--edge-glow-core',`${Math.min(100,65*scale)}%`);
    root.style.setProperty('--edge-glow-halo',`${Math.min(85,38*scale)}%`);
    root.toggleAttribute('data-edge-glow-disabled',intensity===0);
    return ()=>{
      for(const key of ['line','radius','core','halo'])root.style.removeProperty(`--edge-glow-${key}`);
      root.removeAttribute('data-edge-glow-disabled');
    };
  },[intensity,userId]);
  useEffect(()=>{
    if(!css)return;
    const sheet=document.createElement('style');
    sheet.dataset.buttonAppearance='';sheet.textContent=css;document.head.appendChild(sheet);
    return ()=>sheet.remove();
  },[css,userId]);
}

export function EdgeAppearanceSettings({settings,onChange}:{settings:EdgeAppearance&{accent_color:string};onChange:(value:EdgeAppearance)=>void}) {
  const current=normalizeEdgeAppearance(settings);
  const [selected,setSelected]=useState<ButtonAppearanceId>('x');
  const choice=BUTTON_APPEARANCE.find(item=>item.id===selected)!;
  const fallback=['x','bulk','add','report'].includes(selected)&&isHexColor(settings.accent_color)?settings.accent_color:choice.color;
  const color=current.button_colors[selected]||fallback;
  const previewStyle={backgroundColor:color,borderColor:color,color:contrastingText(color),'--own-color-glow':color} as CSSProperties;
  function resetSelected(){const colors={...current.button_colors};delete colors[selected];onChange({...current,button_colors:colors});}
  return <div className={styles.preferences} data-testid="edge-appearance-settings">
    <section>
      <h3>Brilho das bordas</h3>
      <p>Ajuste o brilho dos cards, caixas e botões ao passar o mouse. Cada borda mantém sua própria cor.</p>
      <label htmlFor="edge-glow-intensity">Intensidade <output htmlFor="edge-glow-intensity">{current.border_glow_intensity}%</output></label>
      <input id="edge-glow-intensity" type="range" min="0" max="100" step="1" value={current.border_glow_intensity} onChange={event=>onChange({...current,border_glow_intensity:Number(event.target.value)})}/>
      <div className={styles.scale}><span>Desligado</span><span>Forte</span></div>
      <button type="button" onClick={()=>onChange({...current,border_glow_intensity:EDGE_APPEARANCE_DEFAULTS.border_glow_intensity})}>Restaurar brilho padrão</button>
    </section>
    <section>
      <h3>Cores dos botões do Painel</h3>
      <label htmlFor="appearance-button">Escolha o botão</label>
      <select id="appearance-button" value={selected} onChange={event=>setSelected(event.target.value as ButtonAppearanceId)}>{BUTTON_APPEARANCE.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <label className={styles.color} htmlFor="appearance-button-color">Cor do botão<input id="appearance-button-color" type="color" value={color} onChange={event=>onChange({...current,button_colors:{...current.button_colors,[selected]:event.target.value}})}/><span translate="no">{color.toUpperCase()}</span></label>
      <p>As engrenagens acompanham o botão. O texto ajusta o contraste automaticamente.</p>
      <div className={styles.actions}><button type="button" disabled={!current.button_colors[selected]} onClick={resetSelected}>Restaurar este botão</button><button type="button" disabled={Object.keys(current.button_colors).length===0} onClick={()=>onChange({...current,button_colors:{}})}>Restaurar todas as cores</button></div>
    </section>
    <div className={styles.preview}>
      <span>PRÉVIA DO BRILHO</span>
      <button type="button" className={styles.previewButton} style={previewStyle} data-edge-glow-preview="" data-own-color-glow="" aria-label="Prévia visual do botão">{choice.label}</button>
      <p>Prévia apenas visual, sem executar ações. As mudanças valem só para sua conta. Clique em <strong>Salvar alterações</strong> para guardar.</p>
    </div>
    <PwaInstall/>
  </div>;
}
