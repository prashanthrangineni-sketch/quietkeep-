#!/usr/bin/env python3
"""
QuietKeep schema sweep — CI guardrail against the phantom-column bug class.

WHY THIS EXISTS
Ten production bugs shared one root cause: a Supabase write referencing a
column that does not exist. PostgREST rejects the whole write, supabase-js
RESOLVES with { error } instead of throwing, and a swallowed error makes the
failure invisible. Casualties included: SOS events never recorded, driving
sessions never ended, /api/keeps returning 500 on every call, connector
toggles silently reverting, multi-step voice sub-keeps never created, and
paid QRs never reaching the ledger.

WHAT IT DOES
Extracts every .from('<table>').insert/update/upsert({...}) in src/ and checks
each top-level object key against scripts/schema-snapshot.txt.

  - column missing on a KNOWN table  -> FAIL the build (this is the bug class)
  - table not in the snapshot        -> warn only (new table pending snapshot
                                        refresh, or a dynamic/example name)
  - spreads / computed keys          -> skipped (not statically checkable)

REFRESHING THE SNAPSHOT (after any migration):
  select table_name || '|' || string_agg(column_name, ',' order by column_name)
  from information_schema.columns where table_schema='public'
  group by table_name order by table_name;
Paste the rows into scripts/schema-snapshot.txt.
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SNAPSHOT = os.path.join(HERE, 'schema-snapshot.txt')
SRC = os.path.join(HERE, '..', 'src')

schema = {}
with open(SNAPSHOT) as fh:
    for line in fh:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        t, cols = line.split('|')
        schema[t] = set(cols.split(','))

call_re = re.compile(
    r"\.from\(\s*['\"](\w+)['\"]\s*\)"
    r"(?:\s*\.\w+\([^()]*\))*?"
    r"\s*\.(insert|update|upsert)\(\s*\{",
    re.S)
key_re = re.compile(r"^\s*['\"]?([A-Za-z_][A-Za-z0-9_]*)['\"]?\s*:")

def extract_obj(src, start):
    depth = 0; i = start; in_str = None; esc = False
    while i < len(src):
        c = src[i]
        if in_str:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == in_str: in_str = None
        else:
            if c in '\'"`': in_str = c
            elif c == '{': depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0: return src[start+1:i]
        i += 1
    return None

def strip_comments(body):
    # Remove // line comments and /* */ blocks OUTSIDE strings. A comma inside a
    # comment previously split segments and swallowed the following key — that
    # false negative hid the phantom ai_provider column on the capture route.
    out, i, n, in_str, esc = [], 0, len(body), None, False
    while i < n:
        c = body[i]
        if in_str:
            out.append(c)
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == in_str: in_str = None
            i += 1
        elif c in '\'"`':
            in_str = c; out.append(c); i += 1
        elif c == '/' and i + 1 < n and body[i+1] == '/':
            while i < n and body[i] != '\n': i += 1
        elif c == '/' and i + 1 < n and body[i+1] == '*':
            i += 2
            while i + 1 < n and not (body[i] == '*' and body[i+1] == '/'): i += 1
            i += 2
        else:
            out.append(c); i += 1
    return ''.join(out)

def top_level_keys(body):
    body = strip_comments(body)
    keys, depth, in_str, esc, cur, segs = [], 0, None, False, [], []
    for c in body:
        if in_str:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == in_str: in_str = None
            cur.append(c)
        else:
            if c in '\'"`': in_str = c; cur.append(c)
            elif c in '{[(': depth += 1; cur.append(c)
            elif c in '}])': depth -= 1; cur.append(c)
            elif c == ',' and depth == 0: segs.append(''.join(cur)); cur = []
            else: cur.append(c)
    if cur: segs.append(''.join(cur))
    for seg in segs:
        seg = re.sub(r"^\s*(//[^\n]*\n)+", "", seg.strip()).strip()
        if not seg or seg.startswith('...'):
            continue
        m = key_re.match(seg)
        if m: keys.append(m.group(1))
    return keys

failures, warnings, checked = [], [], 0
for root, _, files in os.walk(SRC):
    for f in files:
        if not f.endswith(('.js', '.jsx', '.ts', '.tsx')):
            continue
        path = os.path.join(root, f)
        src = open(path, encoding='utf-8', errors='replace').read()
        for m in call_re.finditer(src):
            table, op = m.group(1), m.group(2)
            line_no = src[:m.start()].count('\n') + 1
            rel = os.path.relpath(path, os.path.join(HERE, '..'))
            if table not in schema:
                warnings.append(f"{rel}:{line_no}  {op} -> unknown table '{table}' (snapshot stale, or dynamic name)")
                continue
            brace = src.find('{', m.end() - 1)
            body = extract_obj(src, brace)
            if body is None:
                continue
            checked += 1
            bad = [k for k in top_level_keys(body) if k not in schema[table]]
            if bad:
                failures.append(f"{rel}:{line_no}  {op} -> {table}  PHANTOM COLUMNS: {', '.join(bad)}")

print(f"schema-sweep: {checked} write calls checked against {len(schema)} tables")
for w in warnings:
    print(f"  WARN  {w}")
if failures:
    print(f"\nFAILED — {len(failures)} write(s) reference columns that do not exist:")
    for f_ in failures:
        print(f"  FAIL  {f_}")
    print("\nThese writes will be REJECTED by PostgREST at runtime — and supabase-js")
    print("resolves with { error } rather than throwing, so the failure is silent")
    print("unless the error is checked. Fix the column names or refresh the snapshot.")
    sys.exit(1)
print("OK — no phantom columns.")
