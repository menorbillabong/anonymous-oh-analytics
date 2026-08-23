import assert from 'node:assert/strict';
import test from 'node:test';
import { localeForLanguage, normalizeLanguage, translateUiText } from '../lib/i18n.ts';

test('keeps Portuguese as the safe default', () => {
  assert.equal(normalizeLanguage('fr'), 'pt-BR');
  assert.equal(normalizeLanguage(null), 'pt-BR');
  assert.equal(translateUiText('Painel', 'pt-BR'), 'Painel');
});

test('translates exact interface phrases in English and Spanish', () => {
  assert.equal(translateUiText('Painel', 'en'), 'Dashboard');
  assert.equal(translateUiText('Painel', 'es'), 'Panel');
  assert.equal(translateUiText('  SALVAR ALTERAÇÕES  ', 'en'), '  SAVE CHANGES  ');
});

test('translates supported dynamic status messages', () => {
  assert.equal(translateUiText('Meta mensal de 60 publicações atingida.', 'en'), 'Monthly goal of 60 posts reached.');
  assert.equal(translateUiText('12 de 15 publicações atualizadas.', 'es'), '12 de 15 publicaciones actualizadas.');
});

test('does not change unknown text created by users', () => {
  assert.equal(translateUiText('Minha missão personalizada', 'en'), 'Minha missão personalizada');
});

test('returns a locale for every supported language', () => {
  assert.equal(localeForLanguage('pt-BR'), 'pt-BR');
  assert.equal(localeForLanguage('en'), 'en-US');
  assert.equal(localeForLanguage('es'), 'es-ES');
});

