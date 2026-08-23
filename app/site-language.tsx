'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabase';
import {
  languageLabels,
  normalizeLanguage,
  SiteLanguage,
  siteLanguages,
  translateUiText,
} from '@/lib/i18n';
import './site-language.css';

const STORAGE_KEY = 'aoh:language';
const IGNORE_SELECTOR = '[data-i18n-ignore],script,style,code,pre,textarea';
const TRANSLATED_ATTRIBUTES = ['placeholder', 'title', 'aria-label'] as const;
const textStates = new WeakMap<Text, TextState>();
const attributeStates = new WeakMap<Element, Map<string, AttributeState>>();

type LanguageContextValue = {
  language: SiteLanguage;
  setLanguage: (language: SiteLanguage) => void;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

type TextState = { source: string; rendered: string };
type AttributeState = { source: string; rendered: string };

function ignored(node: Node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return Boolean(element?.closest(IGNORE_SELECTOR));
}

function createTranslator(language: SiteLanguage) {
  const translateText = (node: Text) => {
    if (ignored(node)) return;
    const current = node.nodeValue ?? '';
    const previous = textStates.get(node);
    const source = previous && current === previous.rendered ? previous.source : current;
    const rendered = translateUiText(source, language);
    textStates.set(node, { source, rendered });
    if (current !== rendered) node.nodeValue = rendered;
  };

  const translateAttributes = (element: Element) => {
    if (ignored(element)) return;
    let states = attributeStates.get(element);
    if (!states) {
      states = new Map();
      attributeStates.set(element, states);
    }
    for (const attribute of TRANSLATED_ATTRIBUTES) {
      if (!element.hasAttribute(attribute)) continue;
      const current = element.getAttribute(attribute) ?? '';
      const previous = states.get(attribute);
      const source = previous && current === previous.rendered ? previous.source : current;
      const rendered = translateUiText(source, language);
      states.set(attribute, { source, rendered });
      if (current !== rendered) element.setAttribute(attribute, rendered);
    }
  };

  const translateTree = (root: Node) => {
    if (root.nodeType === Node.TEXT_NODE) {
      translateText(root as Text);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE || ignored(root)) return;
    const element = root as Element;
    translateAttributes(element);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) translateText(node as Text);
      else translateAttributes(node as Element);
    }
  };

  return translateTree;
}

export function SiteLanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<SiteLanguage>('pt-BR');

  const setLanguage = useCallback((next: SiteLanguage) => {
    const normalized = normalizeLanguage(next);
    setLanguageState(normalized);
    localStorage.setItem(STORAGE_KEY, normalized);
    document.documentElement.lang = normalized;
    void supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      return supabase.from('user_settings').update({
        language: normalized,
        updated_at: new Date().toISOString(),
      }).eq('user_id', data.user.id);
    });
  }, []);

  useEffect(() => {
    const stored = normalizeLanguage(localStorage.getItem(STORAGE_KEY));
    setLanguageState(stored);
    document.documentElement.lang = stored;
    let active = true;
    const loadAccountLanguage = async (userId?: string) => {
      if (!userId) return;
      const { data } = await supabase.from('user_settings').select('language').eq('user_id', userId).maybeSingle();
      if (!active || !data?.language) return;
      const saved = normalizeLanguage(data.language);
      setLanguageState(saved);
      localStorage.setItem(STORAGE_KEY, saved);
      document.documentElement.lang = saved;
    };
    void supabase.auth.getSession().then(({ data }) => loadAccountLanguage(data.session?.user.id));
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') void loadAccountLanguage(session?.user.id);
    });
    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const translateTree = createTranslator(language);
    translateTree(document.body);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') translateTree(mutation.target);
        if (mutation.type === 'attributes') translateTree(mutation.target);
        mutation.addedNodes.forEach(translateTree);
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...TRANSLATED_ATTRIBUTES],
    });
    return () => observer.disconnect();
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);
  return <LanguageContext.Provider value={value}>{children}<SettingsLanguagePortal/></LanguageContext.Provider>;
}

function SettingsLanguagePortal() {
  const { language } = useSiteLanguage();
  const [target, setTarget] = useState<Element | null>(null);

  useEffect(() => {
    const findTarget = () => setTarget(document.querySelector('.settings-page .settings-grid-full > div:nth-child(2)'));
    findTarget();
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!target) return null;
  return createPortal(
    <label className="settings-language-field">
      <span>Idioma da interface</span>
      <LanguageSelect value={language}/>
      <small className="setting-help">O idioma fica salvo neste perfil.</small>
    </label>,
    target,
  );
}

export function useSiteLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useSiteLanguage must be used inside SiteLanguageProvider');
  return context;
}

export function LanguageSelect({
  value,
  onChange,
  compact = false,
  ariaLabel = 'Idioma da interface',
}: {
  value?: SiteLanguage;
  onChange?: (language: SiteLanguage) => void;
  compact?: boolean;
  ariaLabel?: string;
}) {
  const context = useSiteLanguage();
  const selected = value ?? context.language;
  const change = (next: SiteLanguage) => {
    context.setLanguage(next);
    onChange?.(next);
  };
  return (
    <span className={`site-language-control ${compact ? 'compact' : ''}`} data-i18n-ignore>
      <span aria-hidden="true">◎</span>
      <select value={selected} onChange={(event) => change(normalizeLanguage(event.target.value))} aria-label={ariaLabel}>
        {siteLanguages.map((option) => <option key={option} value={option}>{languageLabels[option]}</option>)}
      </select>
    </span>
  );
}

