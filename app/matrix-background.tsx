'use client';

import {createContext, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {MATRIX_DEFAULTS, matrixRenderBudget, normalizeMatrixAppearance} from '@/lib/matrix-appearance';
import './matrix-background.css';

type Preferences = typeof MATRIX_DEFAULTS;
const MatrixContext = createContext({preferences: MATRIX_DEFAULTS, setPreferences: (_value: Preferences) => {}});

export function MatrixProvider({children}: {children: React.ReactNode}) {
  const [preferences, setPreferences] = useState(MATRIX_DEFAULTS);
  const value = useMemo(() => ({preferences, setPreferences}), [preferences]);
  return <MatrixContext.Provider value={value}>{children}</MatrixContext.Provider>;
}

// Reuse the dashboard's account settings: no extra requests, timers or writes.
export function useMatrixAppearance(settings: Preferences, userId: string) {
  const {setPreferences} = useContext(MatrixContext);
  useEffect(() => {
    setPreferences(normalizeMatrixAppearance(settings));
  }, [settings.matrix_enabled, settings.matrix_color, userId, setPreferences]);
  useEffect(() => () => setPreferences(MATRIX_DEFAULTS), [userId, setPreferences]);
}

export function MatrixBackground() {
  const {preferences} = useContext(MatrixContext);
  const {matrix_enabled: enabled, matrix_color: color} = preferences;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!enabled || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const glyphs = '012345789アイウエオカキクケコサシスセソネノハヒフヘホ';
    let width = 0, height = 0, last = 0, time = 0, frame = 0;
    let budget = matrixRenderBudget(0, 0, 1);
    let streams: {x: number; y: number; speed: number; seed: number}[] = [];
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.font = '13px monospace';
      ctx.fillStyle = color;
      for (const stream of streams) {
        for (let j = 0; j < budget.trail; j++) {
          const y = stream.y - j * 18;
          if (y < 0 || y > height) continue;
          ctx.globalAlpha = (1 - j / budget.trail) * .36;
          ctx.fillText(glyphs[(stream.seed + j * 13 + Math.floor(time / 300)) % glyphs.length], stream.x, y);
        }
      }
      ctx.globalAlpha = 1;
    };
    const tick = (now: number) => {
      if (document.hidden || reduced.matches) { frame = 0; return; }
      if (!last) last = now;
      const delta = now - last;
      if (delta >= budget.frameInterval) {
        const step = Math.min(delta, 100);
        time += step; last = now;
        for (const stream of streams) {
          stream.y += step * .065 * stream.speed;
          if (stream.y - budget.trail * 18 > height) stream.y = -18;
        }
        draw();
      }
      frame = requestAnimationFrame(tick);
    };
    const resume = () => {
      cancelAnimationFrame(frame); frame = 0; last = 0;
      if (!document.hidden && !reduced.matches) frame = requestAnimationFrame(tick);
      else if (reduced.matches) draw();
    };
    const resize = () => {
      width = canvas.clientWidth; height = canvas.clientHeight;
      budget = matrixRenderBudget(width, height, window.devicePixelRatio);
      canvas.width = Math.round(width * budget.pixelRatio);
      canvas.height = Math.round(height * budget.pixelRatio);
      ctx.setTransform(budget.pixelRatio, 0, 0, budget.pixelRatio, 0, 0);
      streams = Array.from({length: budget.columns}, (_, i) => ({
        x: i * width / budget.columns + 7, y: Math.random() * (height + 260),
        speed: .5 + Math.random() * .9, seed: i * 7,
      }));
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    reduced.addEventListener('change', resume);
    document.addEventListener('visibilitychange', resume);
    resize(); resume();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      reduced.removeEventListener('change', resume);
      document.removeEventListener('visibilitychange', resume);
      ctx.clearRect(0, 0, width, height);
    };
  }, [enabled, color]);

  return enabled ? <canvas ref={canvasRef} className="matrix-background" data-matrix-color={color} aria-hidden="true"/> : null;
}

export function MatrixSettings({settings, onChange}: {settings: Preferences; onChange: (next: Preferences) => void}) {
  const presets = [['Verde clássico', '#3de879'], ['Roxo', '#b189ff'], ['Dourado', '#f9ad3e']];
  return <div className="matrix-settings">
    <div>
      <h3>Efeito Matrix</h3>
      <label className="toggle-row"><span>Habilitar efeito Matrix</span><button type="button" role="switch" aria-label="Habilitar efeito Matrix" aria-checked={settings.matrix_enabled} className={settings.matrix_enabled ? 'toggle on' : 'toggle'} onClick={() => onChange({...settings, matrix_enabled: !settings.matrix_enabled})}><i/></button></label>
      <p className="setting-help">O efeito aparece no fundo de todas as telas, sem cobrir os cards e as janelas. Salve as alterações para guardar sua preferência.</p>
      <p className="setting-help">Com a opção de reduzir movimentos do aparelho, o fundo fica estático.</p>
    </div>
    <div>
      <label className="matrix-color-field">Cor do efeito<input type="color" value={settings.matrix_color} onChange={e => onChange({...settings, matrix_color: e.target.value})}/><span translate="no">{settings.matrix_color.toUpperCase()}</span></label>
      <div className="matrix-color-presets" aria-label="Cores do Matrix">{presets.map(([label, value]) => <button type="button" key={value} aria-pressed={settings.matrix_color === value} onClick={() => onChange({...settings, matrix_color: value})}><i style={{backgroundColor: value}} aria-hidden="true"/>{label}</button>)}</div>
    </div>
  </div>;
}
