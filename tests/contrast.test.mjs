import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(value => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}
function contrast(a, b) {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high + 0.05) / (low + 0.05);
}

test('dark palettes keep text readable and covered cells distinct from revealed cells', async () => {
  const css = await readFile(new URL('../styles/tokens.css', import.meta.url), 'utf8');
  for (const theme of ['dark', 'slate']) {
    const block = css.match(new RegExp(':root\\[data-theme="' + theme + '"\\] \\{([\\s\\S]*?)\\n\\}'))[1];
    const colors = Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[\da-fA-F]{6})/g)].map(match => [match[1], match[2]]));
    for (const foreground of ['--text', '--muted']) {
      for (const background of ['--bg', '--panel', '--control']) {
        assert.ok(contrast(colors[foreground], colors[background]) >= 4.5, `${theme}: ${foreground} on ${background}`);
      }
    }
    assert.ok(contrast(colors['--button-text'], colors['--accent']) >= 4.5, `${theme}: button label`);
    for (const revealed of ['--cell-revealed', '--cell-revealed-2']) {
      for (let number = 1; number <= 8; number++) {
        assert.ok(contrast(colors['--n' + number], colors[revealed]) >= 4.5, `${theme}: number ${number}`);
      }
      for (const covered of ['--cell-top', '--cell-top-grad']) {
        assert.ok(contrast(colors[covered], colors[revealed]) >= 3, `${theme}: cell states`);
        assert.ok(contrast(colors['--flag'], colors[covered]) >= 3, `${theme}: flag`);
      }
    }
  }
});
