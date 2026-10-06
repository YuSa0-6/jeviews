// 意味を読む観点に人が正解を付けるための記入表を作り (sheet)、記入済みの表を human.json と expected.json に写す (apply)。
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evalDir, git, hash32, JEVIEWS, readJson, repoDir, writeJson } from './lib.mjs';

const SEMANTIC = /^(input_|error_|secret_)/;
const COLUMNS = ['id', 'truth', 'note', 'jev', 'probability', 'checkId', 'looksFor', 'file', 'url'];
const TRUTHS = new Set(['problem', 'clean']);

export function describeChecks(readme) {
  const rows = [...readme.matchAll(/^\| [a-z_]+ \| `([a-z_]+)` \| (.+?) \|$/gm)];
  return Object.fromEntries(rows.map((m) => [m[1], m[2]]));
}

export function pickPairs(expected, output, name, perSide) {
  const pool = { NG: [], GOOD: [] };
  for (const f of output.files)
    for (const c of f.checks) {
      if (!c.applicable || !SEMANTIC.test(c.checkId) || !(c.verdict in pool)) continue;
      if (expected.files[f.path]?.[c.checkId]) continue;
      pool[c.verdict].push({
        file: f.path,
        checkId: c.checkId,
        jev: c.verdict,
        probability: c.problem?.probability ?? null,
      });
    }
  const rank = (p) => hash32(`${name}:${p.file}:${p.checkId}`);
  for (const side of Object.values(pool)) side.sort((a, b) => rank(a) - rank(b));
  const pick = [...pool.NG.slice(0, perSide), ...pool.GOOD.slice(0, perSide)];
  return pick.sort((a, b) => a.file.localeCompare(b.file) || a.checkId.localeCompare(b.checkId));
}

export function parseSheet(tsv) {
  const [head, ...lines] = tsv.split('\n').filter((l) => l.trim());
  const cols = head.split('\t');
  const at = (row, key) => row[cols.indexOf(key)]?.trim() ?? '';
  const human = {};
  for (const line of lines) {
    const row = line.split('\t');
    const truth = at(row, 'truth');
    if (!truth) continue;
    if (!TRUTHS.has(truth)) throw new Error(`id ${at(row, 'id')}: truth must be problem or clean, got "${truth}"`);
    const note = at(row, 'note');
    (human[at(row, 'file')] ??= {})[at(row, 'checkId')] = { truth, ...(note ? { note } : {}) };
  }
  return human;
}

function latestFirstRun(name, subset) {
  const dir = join(evalDir(name), 'results');
  const runs = readdirSync(dir)
    .filter((f) => f.startsWith(`${subset}.`) && f.endsWith('.r1.json'))
    .sort();
  if (!runs.length) throw new Error(`no scan results for ${name}/${subset}`);
  return readJson(join(dir, runs.at(-1))).output;
}

function blobUrl(name) {
  const remote = git(repoDir(name), ['remote', 'get-url', 'origin'])
    .trim()
    .replace(/\.git$/, '');
  const sha = git(repoDir(name), ['rev-parse', 'HEAD']).trim();
  return (file) => `${remote}/blob/${sha}/${file}`;
}

function sheet(name, subset, perSide) {
  const d = evalDir(name);
  const out = join(d, `${subset}.label.tsv`);
  if (existsSync(out)) throw new Error(`${out} already exists; fill it in and run apply`);
  const expected = readJson(join(d, `${subset}.expected.json`), null);
  const looksFor = describeChecks(readFileSync(join(JEVIEWS, 'README.md'), 'utf8'));
  const url = blobUrl(name);
  const pairs = pickPairs(expected, latestFirstRun(name, subset), name, perSide);
  const rows = pairs.map((p, i) =>
    [
      i + 1,
      '',
      '',
      p.jev,
      p.probability?.toFixed(3) ?? '',
      p.checkId,
      looksFor[p.checkId] ?? '',
      p.file,
      url(p.file),
    ].join('\t'),
  );
  writeFileSync(out, [COLUMNS.join('\t'), ...rows].join('\n') + '\n');
  console.log(`${name}/${subset}: ${pairs.length} pairs -> ${out.replace(JEVIEWS + '/', '')}`);
}

function apply(name, subset) {
  const d = evalDir(name);
  const human = parseSheet(readFileSync(join(d, `${subset}.label.tsv`), 'utf8'));
  const humanPath = join(d, `${subset}.human.json`);
  const merged = readJson(humanPath, {});
  for (const [f, checks] of Object.entries(human)) Object.assign((merged[f] ??= {}), checks);
  writeJson(humanPath, merged);
  const expectedPath = join(d, `${subset}.expected.json`);
  const expected = readJson(expectedPath, null);
  let n = 0;
  for (const [f, checks] of Object.entries(merged))
    for (const [c, v] of Object.entries(checks))
      if (expected.files[f]) {
        expected.files[f][c] = { ...v, source: 'human' };
        n++;
      }
  writeJson(expectedPath, expected);
  console.log(`${name}/${subset}: ${n} human labels in human.json and expected.json`);
}

function main() {
  const [cmd, name, subset, perSide = '10'] = process.argv.slice(2);
  if (cmd === 'sheet' && name && subset) return sheet(name, subset, Number(perSide));
  if (cmd === 'apply' && name && subset) return apply(name, subset);
  throw new Error('usage: label.mjs sheet <repo> <subset> [perSide] | label.mjs apply <repo> <subset>');
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) main();
