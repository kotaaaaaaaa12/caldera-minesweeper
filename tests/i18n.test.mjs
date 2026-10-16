import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import en from '../src/locales/en.js';
import ja from '../src/locales/ja.js';

test('English and Japanese resources cover the same keys and interpolation values', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ja).sort());
  for (const key of Object.keys(en)) {
    assert.ok(en[key].trim() && ja[key].trim(), key);
    const slots = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(slots(en[key]), slots(ja[key]), key);
  }
});

test('the complete application changes language without resetting gameplay or forms', async () => {
  const dom = new Window({ url: 'https://example.com/', settings: {
    disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true,
  } });
  dom.document.write(await readFile(new URL('../index.html', import.meta.url), 'utf8'));
  Object.defineProperty(dom.navigator, 'languages', { configurable: true, value: ['ja-JP', 'en-US'] });
  Object.defineProperty(dom.navigator, 'language', { configurable: true, value: 'ja-JP' });
  const originalFetch = globalThis.fetch;
  const originalTimeout = globalThis.setTimeout;
  const timeouts = [];
  globalThis.setTimeout = (...args) => { const handle = originalTimeout(...args); timeouts.push(handle); return handle; };
  const originalInterval = globalThis.setInterval;
  const intervals = [];
  globalThis.setInterval = (...args) => { const handle = originalInterval(...args); intervals.push(handle); return handle; };
  const restore = [];
  for (const key of ['window','document','navigator','localStorage','CustomEvent','requestAnimationFrame','cancelAnimationFrame','getComputedStyle']) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    restore.push(() => old ? Object.defineProperty(globalThis, key, old) : delete globalThis[key]);
    const value = ['requestAnimationFrame','cancelAnimationFrame','getComputedStyle'].includes(key) ? dom[key].bind(dom) : dom[key];
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  localStorage.setItem('minesweeper.caldera.v1', JSON.stringify({ settings: { animations: false } }));
  globalThis.fetch = async () => Response.json({ ok: true, rows: [{ name: 'Player', time_ms: 12500, created_at: '2026-10-16' }] });
  let i18n;
  try {
    await import('../src/main.js');
    i18n = await import('../src/i18n.js');
    const { UI } = await import('../src/ui.js');
    const { Renderer } = await import('../src/render.js');
    const { Engine } = await import('../src/engine.js');
    const { buildShare } = await import('../src/share.js');
    const { formatTime } = await import('../src/timer.js');
    const { ACHIEVEMENTS } = await import('../src/achievements.js');
    const leaderboard = await import('../src/leaderboard.js');
    const $ = selector => document.querySelector(selector);
    assert.equal(document.documentElement.lang, 'ja');
    assert.equal(document.title, 'Caldera・マインスイーパー');
    assert.equal($('[data-diff="beginner"]').textContent, '初級');
    assert.equal($('#set-name').placeholder, '匿名');
    assert.equal($('#btn-settings').getAttribute('aria-label'), '設定を開く');
    assert.match($('.cell').getAttribute('aria-label'), /1行1列、未開封/);
    assert.match($('link[rel="manifest"]').href, /manifest-ja/);

    // Ensure all visible static text and accessibility attributes use translation keys.
    for (const node of document.querySelectorAll('*')) {
      for (const attribute of node.attributes) {
        if (attribute.name.startsWith('data-i18n')) assert.ok(Object.hasOwn(ja, attribute.value), attribute.value);
      }
    }
    const walker = document.createTreeWalker(document.body, dom.NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!/[A-Za-z]/.test(node.textContent) || node.parentElement.closest('script,style,[data-i18n]')) continue;
      assert.equal(node.textContent.trim(), 'Caldera');
    }
    for (const node of document.querySelectorAll('[title],[aria-label],[placeholder]')) {
      if (node.classList.contains('cell')) continue;
      for (const attr of ['title','aria-label','placeholder']) {
        const value = node.getAttribute(attr);
        if (value && /[A-Za-z]/.test(value)) assert.ok(node.hasAttribute('data-i18n-' + attr), value);
      }
    }

    $('#btn-settings').click();
    assert.equal(document.activeElement, $('#settings-dialog [data-panel-title]'));
    assert.equal($('#set-language').disabled, false);
    assert.equal($('#settings-close').matches(':focus'), false);
    $('#settings-close').click();
    $('#btn-leaderboard').click();
    assert.equal(document.activeElement, $('#leaderboard-dialog [data-panel-title]'));
    assert.equal($('#lb-close').matches(':focus'), false);
    $('#lb-close').click();
    $('.cell[data-index="40"]').click();
    const before = JSON.parse(localStorage.getItem('minesweeper.caldera.v1')).savedGame;
    assert.ok(before?.snap.firstClickDone);
    const select = $('#set-language');
    $('#set-name').value = 'Uncommitted name';
    select.value = 'en';
    select.dispatchEvent(new dom.Event('change'));
    assert.equal(document.documentElement.lang, 'en');
    assert.equal($('[data-diff="beginner"]').textContent, 'Beginner');
    assert.equal($('#set-name').value, 'Uncommitted name');
    assert.match($('.cell').getAttribute('aria-label'), /row 1, column 1/);
    const after = JSON.parse(localStorage.getItem('minesweeper.caldera.v1')).savedGame;
    assert.deepEqual(after, before);
    assert.equal(JSON.parse(localStorage.getItem('minesweeper.caldera.v1')).settings.language, 'en');
    select.value = 'ja';
    select.dispatchEvent(new dom.Event('change'));

    // An existing result, name entry, rank, toast, and statistics update in place.
    const ui = new UI();
    ui.showResult({ won: true, timeMs: 12500, metrics: { threeBV: 20, threeBVps: 1.6, efficiency: 0.8 } });
    ui.setOverlayRank('leaderboard.rank', { rank: 2, difficulty: 'beginner' });
    ui.showOverlaySubmit('Pending name');
    assert.equal(document.activeElement, $('#overlay-title'));
    assert.equal($('#overlay-name').matches(':focus'), false);
    ui.setModeBadge({ daily: true, noGuess: true });
    ui.toastAchievements([ACHIEVEMENTS[0]]);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.match($(".toast strong").textContent, /実績解除：はじめてのクリア/);
    ui.renderLeaderboard({ rows: [{ name: 'Anonymous', time_ms: 12500 }] });
    const stats = { best: {}, games: {}, wins: {}, streak: 3, bestStreak: 5 };
    ui.openStats(stats, new Set(['first-win']));
    assert.match($('#overlay-title').textContent, /クリア/);
    assert.match($('#overlay-rank').textContent, /初級ランキング：2位/);
    assert.match($('#lb-list').textContent, /匿名/);
    assert.match($('#stats-content').textContent, /はじめてのクリア/);
    i18n.setLanguage('en');
    ui.refreshLanguage(); ui.refreshStats(stats);
    assert.equal($('#overlay-title').textContent, 'You win!');
    assert.match($(".toast strong").textContent, /Achievement: First Clear/);
    assert.match($('#overlay-rank').textContent, /#2 on the Beginner leaderboard/);
    assert.equal($('#overlay-name').value, 'Pending name');
    assert.equal($('#overlay-lb').classList.contains('hidden'), false);
    assert.match($('#stats-content').textContent, /First Clear/);
    assert.equal(formatTime(119900), '2m 0s');
    i18n.setLanguage('ja'); ui.refreshLanguage(); ui.refreshStats(stats);
    assert.equal(formatTime(12500), '12.5秒');
    assert.match($('#overlay-metrics').textContent, /効率 80％/);
    assert.match($('#mode-badge').textContent, /デイリー.*推測不要/);
    const share = buildShare({ won: true, difficulty: 'beginner', timeMs: 12500, streak: 3, noGuess: true });
    assert.match(share, /初級/); assert.match(share, /12.5秒/); assert.match(share, /3連勝/);

    const renderer = new Renderer(document.createElement('div'));
    renderer.build(new Engine({ seed: 42 }));
    assert.match(renderer.label(0), /1行1列、未開封/);
    globalThis.fetch = async () => Response.json({ ok: false, error: 'Too many submissions. Try again in a minute.' }, { status: 429 });
    const failure = await leaderboard.topScores('beginner');
    assert.equal(failure.errorKey, 'error.rateLimit');
    assert.match(failure.error, /1分ほど/);
    ui.renderLeaderboard(failure); assert.match($('#lb-list').textContent, /1分ほど/);
    i18n.setLanguage('en'); ui.refreshLanguage(); assert.match($('#lb-list').textContent, /Try again in a minute/);

    assert.equal(i18n.resolveLanguage('auto', ['ja-JP']), 'ja');
    assert.equal(i18n.resolveLanguage('auto', ['en-US','ja-JP']), 'en');
    assert.equal(i18n.resolveLanguage('auto', ['fr-FR','ja-JP']), 'ja');
    assert.equal(i18n.resolveLanguage('en', ['ja-JP']), 'en');
    i18n.setLanguage('auto'); assert.equal(document.documentElement.lang, 'ja');
  } finally {
    i18n?.setLanguage('en');
    globalThis.fetch = originalFetch;
    timeouts.forEach(clearTimeout);
    globalThis.setTimeout = originalTimeout;
    intervals.forEach(clearInterval);
    globalThis.setInterval = originalInterval;
    for (const undo of restore.reverse()) undo();
    await dom.happyDOM.abort();
    // The actual controller uses a Node timer; do not keep the test process alive.
  }
});
