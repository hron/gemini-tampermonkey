import fs from 'node:fs';
import path from 'node:path';

import { USERSCRIPT_HEADER } from '../src/meta.js';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const OUTPUT_FILE = path.join(DIST_DIR, 'gemini-shortcuts.user.js');

const SOURCE_FILES = [
  'src/lib/scrolling.js',
  'src/lib/dom.js',
  'src/features/skip-to-previous-prompt.js',
  'src/features/page-scroll.js',
  'src/main.js',
];

function stripModuleSyntax(code) {
  // Remove single-line and multi-line ESM import statements
  let stripped = code.replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];\r?\n?/gm, '');
  // Convert exported declarations into local declarations
  stripped = stripped.replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/gm, '');
  return stripped.trim();
}

function build() {
  const sections = SOURCE_FILES.map((relPath) => {
    const absPath = path.join(ROOT_DIR, relPath);
    const raw = fs.readFileSync(absPath, 'utf8');
    const body = stripModuleSyntax(raw);
    return `  // --- ${relPath} ---\n${body
      .split('\n')
      .map((line) => (line.length > 0 ? `  ${line}` : ''))
      .join('\n')}`;
  });

  const bundle = `${USERSCRIPT_HEADER}

(function () {
  'use strict';

${sections.join('\n\n')}
})();
`;

  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, bundle, 'utf8');
  console.log(`Built ${path.relative(ROOT_DIR, OUTPUT_FILE)} (${bundle.length} bytes)`);
}

build();
