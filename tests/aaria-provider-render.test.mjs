// tests/aaria-provider-render.test.mjs
// Render-time TDZ check for AariaProvider.
// Verifies that no useEffect/useCallback/useMemo dependency array or synchronous
// render-time expression accesses an identifier declared later in AariaProvider.

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';

const code = readFileSync(new URL('../src/lib/context/aaria.jsx', import.meta.url), 'utf8');
const sf = ts.createSourceFile('aaria.jsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);

let providerNode = null;
function findProvider(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'AariaProvider') {
    providerNode = node;
    return;
  }
  ts.forEachChild(node, findProvider);
}
findProvider(sf);

assert.ok(providerNode, 'AariaProvider function must be present in src/lib/context/aaria.jsx');

const body = providerNode.body;
assert.ok(body, 'AariaProvider must have a function body');

// 1. Collect all declarations (const, let, function) declared directly inside AariaProvider
const declarations = new Map(); // name -> { line, pos }
for (const stmt of body.statements) {
  if (ts.isVariableStatement(stmt)) {
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) {
        const pos = decl.getStart(sf);
        const line = sf.getLineAndCharacterOfPosition(pos).line + 1;
        declarations.set(decl.name.text, { pos, line });
      } else if (ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name)) {
        for (const elem of decl.name.elements) {
          if (elem.name && ts.isIdentifier(elem.name)) {
            const pos = elem.getStart(sf);
            const line = sf.getLineAndCharacterOfPosition(pos).line + 1;
            declarations.set(elem.name.text, { pos, line });
          }
        }
      }
    }
  } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
    const pos = stmt.name.getStart(sf);
    const line = sf.getLineAndCharacterOfPosition(pos).line + 1;
    declarations.set(stmt.name.text, { pos, line });
  }
}

console.log(`Found ${declarations.size} local declarations in AariaProvider`);

// 2. Scan for hook dependency arrays evaluated before the dependency is declared
const violations = [];

function checkHooks(node) {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee) && ['useEffect', 'useCallback', 'useMemo'].includes(callee.text)) {
      const depArg = node.arguments[1];
      if (depArg && ts.isArrayLiteralExpression(depArg)) {
        const callLine = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        for (const elem of depArg.elements) {
          let rootIdent = null;
          if (ts.isIdentifier(elem)) {
            rootIdent = elem;
          } else if (ts.isPropertyAccessExpression(elem)) {
            let curr = elem;
            while (ts.isPropertyAccessExpression(curr)) curr = curr.expression;
            if (ts.isIdentifier(curr)) rootIdent = curr;
          }
          if (rootIdent) {
            const name = rootIdent.text;
            const depPos = rootIdent.getStart(sf);
            const depLine = sf.getLineAndCharacterOfPosition(depPos).line + 1;
            if (declarations.has(name)) {
              const decl = declarations.get(name);
              if (decl.pos > depPos) {
                violations.push({
                  type: 'hook-dependency-array-tdz',
                  hook: callee.text,
                  hookLine: callLine,
                  identifier: name,
                  depLine,
                  declLine: decl.line,
                });
              }
            }
          }
        }
      }
    }
  }
  ts.forEachChild(node, checkHooks);
}

checkHooks(body);

// 3. Scan for top-level synchronous expressions evaluated before declaration
for (const stmt of body.statements) {
  function checkSyncExpr(node) {
    // Skip functions and callbacks as they are not evaluated synchronously during top-level render
    if (ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isFunctionDeclaration(node)) {
      return;
    }
    if (ts.isIdentifier(node)) {
      const name = node.text;
      const pos = node.getStart(sf);
      if (declarations.has(name)) {
        const decl = declarations.get(name);
        // Exclude the declaration itself
        if (decl.pos > pos) {
          // If already recorded in hook dependency array, don't duplicate
          if (!violations.some((v) => v.identifier === name && v.depLine === sf.getLineAndCharacterOfPosition(pos).line + 1)) {
            violations.push({
              type: 'sync-render-tdz',
              identifier: name,
              refLine: sf.getLineAndCharacterOfPosition(pos).line + 1,
              declLine: decl.line,
            });
          }
        }
      }
    }
    ts.forEachChild(node, checkSyncExpr);
  }
  checkSyncExpr(stmt);
}

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
