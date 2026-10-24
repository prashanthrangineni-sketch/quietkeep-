import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@supabase/supabase-js' || specifier === '@/lib/supabase-server' || specifier.endsWith('/lib/supabase-server')) {
    return nextResolve(pathToFileURL(path.resolve(process.cwd(), 'tests/mock-supabase.mjs')).href, context);
  }
  if (specifier.startsWith('next/') && !specifier.endsWith('.js')) {
    return nextResolve(specifier + '.js', context);
  }
  if (specifier.startsWith('@/')) {
    const rel = specifier.slice(2);
    const root = path.resolve(process.cwd(), 'src');
    let candidate = path.join(root, rel);
    if (!fs.existsSync(candidate) && fs.existsSync(candidate + '.js')) {
      candidate = candidate + '.js';
    } else if (!fs.existsSync(candidate) && fs.existsSync(candidate + '.jsx')) {
      candidate = candidate + '.jsx';
    }
    return nextResolve(pathToFileURL(candidate).href, context);
  }
  return nextResolve(specifier, context);
}