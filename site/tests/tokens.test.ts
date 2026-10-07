import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// design.md §8: colors, sizes and radii come from the tokens in app/globals.css only.
const ROOTS = ['app', 'components'];
const BANNED = [/#[0-9a-fA-F]{3,8}\b/, /rgba?\(/, /-\[[^\]]*(px|#|rem)/];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe('design tokens', () => {
  it('no color or size literals outside globals.css', () => {
    const hits: string[] = [];
    for (const root of ROOTS) {
      let list: string[] = [];
      try { list = files(path.resolve(__dirname, '..', root)); } catch { continue; }
      for (const f of list) {
        readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
          if (BANNED.some((re) => re.test(line))) hits.push(`${path.relative(process.cwd(), f)}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(hits).toEqual([]);
  });
});
