'use client';

import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { postDateKey } from '@/lib/post-date';
import { defaultPeriodStart, oldestActivePostDate, type ActivePeriod } from '@/lib/tracking-period';

type OpenPeriodModalProps = {
  posts: any[];
  onClose: () => void;
  onSuccess: (period: ActivePeriod) => void | Promise<void>;
};

function openErrorMessage(error: any) {
  const message = String(error?.message || '');
  const oldest = message.match(/TRACKING_PERIOD_START_AFTER_CURRENT_POST:(\d{4}-\d{2}-\d{2})/);
  const latestClosed = message.match(/TRACKING_PERIOD_OVERLAPS_CLOSED:(\d{4}-\d{2}-\d{2})/);
  if (oldest) return `Já existem publicações no período atual. Escolha ${oldest[1]} ou uma data anterior para manter todas elas.`;
  if (latestClosed) return `A data deve ser posterior ao último período fechado, que terminou em ${latestClosed[1]}.`;
  if (message.includes('TRACKING_PERIOD_ALREADY_OPEN')) return 'Já existe um período aberto para esta conta.';
  if (message.includes('TRACKING_PERIOD_INVALID_START')) return 'A data inicial não pode ser futura.';
  return 'Não foi possível abrir o período agora.';
}
export default function OpenPeriodModal({ posts, onClose, onSuccess }: OpenPeriodModalProps) {
  const today = postDateKey(new Date());
  const oldestCurrent = useMemo(() => oldestActivePostDate(posts), [posts]);
  const [start, setStart] = useState(() => defaultPeriodStart(today));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const startAfterOldest = Boolean(oldestCurrent && start > oldestCurrent);
  const valid = Boolean(start && start <= today && !startAfterOldest);

  async function confirmPeriod() {
    if (!valid) return;
    setSaving(true);
    setMessage('');
    const { data, error } = await supabase.rpc('open_my_period', { p_start_date: start });
    setSaving(false);
    if (error) {
      setMessage(openErrorMessage(error));
      return;
    }
    await onSuccess(data as ActivePeriod);
  }

  return <div className="modal-backdrop archive-period-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="modal archive-period-modal" role="dialog" aria-modal="true" aria-labelledby="open-period-title" onMouseDown={event => event.stopPropagation()}>
      <div className="modal-head">
        <div><small>NOVO CICLO</small><h2 id="open-period-title">Abrir período</h2></div>
        <button type="button" className="close-btn" aria-label="Fechar" disabled={saving} onClick={onClose}>×</button>
      </div>
      <div className="modal-body">
        <p className="archive-intro">Defina a data inicial. As buscas no X e as novas publicações serão vinculadas ao período aberto.</p>
        <div className="archive-date-grid single-date">
          <label>Data de início<input autoFocus type="date" value={start} max={today} onChange={event => { setStart(event.target.value); setMessage(''); }}/></label>
        </div>
        {oldestCurrent && <p className="archive-helper">Publicação atual mais antiga: <strong>{oldestCurrent}</strong>. Ela será preservada neste período.</p>}
        {startAfterOldest && <p className="archive-error">Escolha {oldestCurrent} ou uma data anterior para não deixar publicações existentes fora do período.</p>}
        {start > today && <p className="archive-error">A data inicial não pode ser futura.</p>}
        {message && <p className="archive-error">{message}</p>}
        <p className="archive-warning">Nada será apagado. O período permanecerá aberto até você usar “Fechar período”.</p>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn" disabled={saving} onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-primary archive-confirm" disabled={saving || !valid} onClick={confirmPeriod}>{saving ? 'ABRINDO...' : 'CONFIRMAR ABERTURA'}</button>
      </div>
    </section>
  </div>;
}
