import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const DIST_PATH = path.resolve(import.meta.dirname, '../dist/gemini-shortcuts.user.js');

describe('built userscript artifact', () => {
  it('exists with a valid Tampermonkey metadata header and valid JS syntax', () => {
    assert.ok(fs.existsSync(DIST_PATH), 'dist/gemini-shortcuts.user.js must exist after build');
    const source = fs.readFileSync(DIST_PATH, 'utf8');

    assert.match(source, /\/\/ ==UserScript==/);
    assert.match(source, /\/\/ @name\s+Gemini Keyboard Shortcuts/);
    assert.match(source, /\/\/ @match\s+https:\/\/gemini\.google\.com\/\*/);
    assert.match(source, /\/\/ @grant\s+GM_addStyle/);
    assert.match(source, /\/\/ ==\/UserScript==/);

    // Must not contain top-level ESM import/export statements
    assert.doesNotMatch(source, /^\s*(import|export)\s/m);

    // Must parse cleanly as a classic browser script
    assert.doesNotThrow(() => new vm.Script(source, { filename: 'gemini-shortcuts.user.js' }));
  });
});
