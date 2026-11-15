// tests/aaria-provider-render.test.mjs
// Render-time TDZ check for AariaProvider.
// Verifies that no useEffect/useCallback/useMemo/useLayoutEffect dependency array
// or synchronous render-time expression accesses an identifier declared later in AariaProvider.
//
// Rewritten with ZERO external dependencies (node: built-ins only) so that CI runs
// cleanly without requiring npm install / node_modules.

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

function stripComments(code) {
  let result = '';
  let i = 0;
  while (i < code.length) {
    if (code[i] === '/' && code[i + 1] === '/') {
      result += '  ';
      i += 2;
      while (i < code.length && code[i] !== '\n') {
        result += ' ';
        i++;
      }
    } else if (code[i] === '/' && code[i + 1] === '*') {
      result += '  ';
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
        if (code[i] === '\n') result += '\n';
        else result += ' ';
        i++;
      }
      if (i < code.length) {
        result += '  ';
        i += 2;
      }
    } else if (code[i] === "'" || code[i] === '"' || code[i] === '`') {
      const quote = code[i];
      result += quote;
      i++;
      while (i < code.length) {
        const c = code[i];
        if (c === '\\') {
          result += c + (code[i + 1] || '');
          i += 2;
          continue;
        }
        if (c === quote) {
          result += c;
          i++;
          break;
        }
        result += c;
        i++;
      }
    } else {
      result += code[i];
      i++;
    }
  }
  return result;
}

export function checkAariaProvider(code) {
  const clean = stripComments(code);

  const match = /function\s+AariaProvider\b/.exec(clean);
  assert.ok(match, 'AariaProvider function must be present in src/lib/context/aaria.jsx');

  let p = match.index;
  while (p < clean.length && clean[p] !== '(') p++;
  let paren = 0;
  while (p < clean.length) {
    if (clean[p] === '(') paren++;
    else if (clean[p] === ')') {
      paren--;
      if (paren === 0) { p++; break; }
    }
    p++;
  }
  while (p < clean.length && clean[p] !== '{') p++;
  assert.ok(p < clean.length && clean[p] === '{', 'AariaProvider must have a function body');
  const bodyStart = p; // opening '{'

  function getLine(idx) {
    return code.slice(0, idx).split('\n').length;
  }

  // 1. Collect all declarations (const, let, function) declared directly inside AariaProvider (depth === 1)
  const declarations = new Map();
  let depth = 0;
  let idx = bodyStart;

  while (idx < clean.length) {
    const ch = clean[idx];
    if (ch === '{') {
      depth++;
      idx++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) break;
      idx++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch;
      idx++;
      while (idx < clean.length && clean[idx] !== q) {
        if (clean[idx] === '\\') idx++;
        idx++;
      }
      idx++;
      continue;
    }

    if (depth === 1) {
      const sub = clean.slice(idx);
      const funcMatch = /^function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/.exec(sub);
      if (funcMatch) {
        const name = funcMatch[1];
        declarations.set(name, { pos: idx, line: getLine(idx) });
        idx += funcMatch[0].length;
        continue;
      }
      const varMatch = /^(const|let)\s+/.exec(sub);
      if (varMatch) {
        const declStart = idx;
        idx += varMatch[0].length;
        let declEnd = idx;
        let dBracket = 0;
        let dBrace = 0;
        while (declEnd < clean.length) {
          const c = clean[declEnd];
          if (c === '[') dBracket++;
          else if (c === ']') dBracket--;
          else if (c === '{') dBrace++;
          else if (c === '}') dBrace--;
          else if (dBracket === 0 && dBrace === 0 && (c === '=' || c === ';')) {
            break;
          }
          declEnd++;
        }
        const declPattern = clean.slice(idx, declEnd).trim();
        if (declPattern.startsWith('{')) {
          const inner = declPattern.slice(1, declPattern.lastIndexOf('}'));
          for (const part of inner.split(',')) {
            const trimmed = part.trim();
            if (!trimmed) continue;
            let id = trimmed.split('=')[0].trim();
            if (id.includes(':')) id = id.split(':')[1].trim();
            if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(id)) {
              declarations.set(id, { pos: declStart, line: getLine(declStart) });
            }
          }
        } else if (declPattern.startsWith('[')) {
          const inner = declPattern.slice(1, declPattern.lastIndexOf(']'));
          for (const part of inner.split(',')) {
            const id = part.trim().split('=')[0].trim();
            if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(id)) {
              declarations.set(id, { pos: declStart, line: getLine(declStart) });
            }
          }
        } else {
          const id = declPattern.split('=')[0].trim();
          if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(id)) {
            declarations.set(id, { pos: declStart, line: getLine(declStart) });
          }
        }
        idx = declEnd;
        continue;
      }
    }
    idx++;
  }

  // 2. Scan for hook calls and check dependency arrays
  const violations = [];
  const hookRegex = /\b(useEffect|useCallback|useMemo|useLayoutEffect)\s*\(/g;
  let hMatch;
  while ((hMatch = hookRegex.exec(clean)) !== null) {
    const hookName = hMatch[1];
    const hookIdx = hMatch.index;
    if (hookIdx < bodyStart || hookIdx > idx) continue;

    let argP = hookIdx + hMatch[0].length;
    let pDepth = 1;
    let bDepth = 0;
    let brDepth = 0;
    let commaPos = -1;
    let hookEnd = -1;

    while (argP < clean.length) {
      const c = clean[argP];
      if (c === "'" || c === '"' || c === '`') {
        const q = c;
        argP++;
        while (argP < clean.length && clean[argP] !== q) {
          if (clean[argP] === '\\') argP++;
          argP++;
        }
        argP++;
        continue;
      }
      if (c === '(') pDepth++;
      else if (c === ')') {
        pDepth--;
        if (pDepth === 0) {
          hookEnd = argP;
          break;
        }
      } else if (c === '{') bDepth++;
      else if (c === '}') bDepth--;
      else if (c === '[') brDepth++;
      else if (c === ']') brDepth--;
      else if (c === ',' && pDepth === 1 && bDepth === 0 && brDepth === 0) {
        commaPos = argP;
      }
      argP++;
    }

    if (commaPos !== -1 && hookEnd !== -1) {
      const secondArgText = clean.slice(commaPos + 1, hookEnd).trim();
      const arrayMatch = /^\[([\s\S]*?)\]/.exec(secondArgText);
      if (arrayMatch) {
        const arrayStartInClean = clean.indexOf('[', commaPos + 1);
        const innerArray = arrayMatch[1];
        const idRegex = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
        let idMatch;
        while ((idMatch = idRegex.exec(innerArray)) !== null) {
          const ident = idMatch[0];
          const charBefore = innerArray[idMatch.index - 1];
          if (charBefore === '.') continue;
          if (declarations.has(ident)) {
            const decl = declarations.get(ident);
            const depPos = arrayStartInClean + 1 + idMatch.index;
            const depLine = getLine(depPos);
            if (decl.pos > depPos) {
              violations.push({
                type: 'hook-dependency-array-tdz',
                hook: hookName,
                hookLine: getLine(hookIdx),
                identifier: ident,
                depLine,
                declLine: decl.line,
              });
            }
          }
        }
      }
    }
  }

  // 3. Scan top-level statements for synchronous TDZ references
  let curDepth = 0;
  let skipFnDepth = null;
  let j = bodyStart;

  while (j < idx) {
    const c = clean[j];

    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      j++;
      while (j < clean.length && clean[j] !== q) {
        if (clean[j] === '\\') j++;
        j++;
      }
      j++;
      continue;
    }

    if (c === '{') {
      curDepth++;
      j++;
      continue;
    }
    if (c === '}') {
      if (skipFnDepth !== null && curDepth === skipFnDepth) {
        skipFnDepth = null;
      }
      curDepth--;
      if (curDepth === 0) break;
      j++;
      continue;
    }

    if (curDepth === 1) {
      const sub = clean.slice(j);
      if (/^function\b/.test(sub)) {
        skipFnDepth = curDepth + 1;
      } else if (/^=>/.test(sub)) {
        let k = j + 2;
        while (k < clean.length && /\s/.test(clean[k])) k++;
        if (clean[k] === '{') {
          skipFnDepth = curDepth + 1;
        }
      }

      if (skipFnDepth === null) {
        const idMatch = /^[a-zA-Z_$][a-zA-Z0-9_$]*/.exec(sub);
        if (idMatch) {
          const ident = idMatch[0];
          const prevChar = clean[j - 1];
          if (prevChar !== '.' && !['const', 'let', 'var', 'function', 'return', 'import', 'export', 'typeof', 'true', 'false', 'null', 'undefined', 'new'].includes(ident)) {
            if (declarations.has(ident)) {
              const decl = declarations.get(ident);
              if (decl.pos > j) {
                const line = getLine(j);
                if (!violations.some(v => v.identifier === ident && (v.depLine === line || v.refLine === line))) {
                  violations.push({
                    type: 'sync-render-tdz',
                    identifier: ident,
                    refLine: line,
                    declLine: decl.line,
                  });
                }
              }
            }
          }
          j += ident.length;
          continue;
        }
      }
    }
    j++;
  }

  return { declarations, violations };
}

// Main execution
const code = readFileSync(new URL('../src/lib/context/aaria.jsx', import.meta.url), 'utf8');
const { declarations, violations } = checkAariaProvider(code);

console.log(`Found ${declarations.size} local declarations in AariaProvider`);

if (violations.length > 0) {
  console.error('\nFAIL: TDZ violations detected in AariaProvider:');
  for (const v of violations) {
    if (v.type === 'hook-dependency-array-tdz') {
      console.error(
        `  - ${v.hook} at line ${v.hookLine} has dependency '${v.identifier}' at line ${v.depLine}, but '${v.identifier}' is declared later at line ${v.declLine}`
      );
    } else {
      console.error(
        `  - Synchronous reference to '${v.identifier}' at line ${v.refLine} before its declaration at line ${v.declLine}`
      );
    }
  }
  process.exit(1);
}

console.log('PASS: No TDZ references in AariaProvider dependency arrays or render-time expressions.');
