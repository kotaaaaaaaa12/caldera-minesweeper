import en from './locales/en.js';
import ja from './locales/ja.js';
import * as storage from './storage.js';

export const messages = Object.freeze({ en, ja });
let preference = storage.get('settings', {}).language || 'auto';

export function resolveLanguage(value = preference, languages = globalThis.navigator?.languages || [globalThis.navigator?.language || 'en']) {
  if (value === 'en' || value === 'ja') return value;
  for (const language of languages) {
    const code = String(language).toLowerCase().split(/[-_]/)[0];
    if (Object.hasOwn(messages, code)) return code;
  }
  return 'en';
}

export function languagePreference() { return preference; }

export function t(key, values = {}) {
  const template = messages[resolveLanguage()][key] ?? en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
}

export function difficultyLabel(value) {
  return value?.startsWith('daily-') ? t('game.dailyDate', { date: value.slice(6) }) : t('difficulty.' + (value || 'custom'));
}

export function applyTranslations(root = globalThis.document) {
  if (!root) return;
  for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const attribute of ['title', 'aria-label', 'placeholder', 'content']) {
    for (const node of root.querySelectorAll(`[data-i18n-${attribute}]`)) node.setAttribute(attribute, t(node.getAttribute(`data-i18n-${attribute}`)));
  }
  const locale = resolveLanguage();
  if (root.documentElement) {
    root.documentElement.lang = locale;
    const manifest = root.querySelector('link[rel="manifest"]');
    if (manifest) manifest.href = locale === 'ja' ? './manifest-ja.webmanifest' : './manifest.webmanifest';
  }
}

export function setLanguage(value) {
  preference = ['auto', 'en', 'ja'].includes(value) ? value : 'auto';
  applyTranslations();
  if (globalThis.window) window.dispatchEvent(new CustomEvent('caldera-languagechange'));
}

// Preserve automatic selection when the browser's preferred languages change.
if (globalThis.window) window.addEventListener('languagechange', () => {
  if (preference === 'auto') setLanguage('auto');
});
