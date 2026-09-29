import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describeChecks, parseSheet, pickPairs } from './label.mjs';

const check = (checkId, verdict, probability = 0.5) => ({ checkId, applicable: true, verdict, problem: { probability } });

describe('describeChecks', () => {
  it('reads what each check looks for from the README table', () => {
    const looksFor = describeChecks(readFileSync(new URL('../../README.md', import.meta.url), 'utf8'));
    expect(looksFor.error_empty_catch).toContain('catch');
    expect(looksFor.secret_hardcoded).toContain('API キー');
  });
});

describe('pickPairs', () => {
  const expected = { files: { 'a.ts': { error_empty_catch: { truth: 'problem', source: 'codex' } } } };
  const output = { files: [
    { path: 'a.ts', checks: [check('error_empty_catch', 'NG'), check('input_unchecked_use', 'NG'), check('lint_unused_import', 'NG')] },
    { path: 'b.ts', checks: [check('secret_logged', 'GOOD'), check('error_unhandled_promise', 'NEED_REVIEW'), { ...check('secret_hardcoded', 'GOOD'), applicable: false }] },
  ] };

  it('takes only unlabeled semantic checks that Jev answered NG or GOOD', () => {
    const pairs = pickPairs(expected, output, 'x', 10);
    expect(pairs.map((p) => `${p.file}#${p.checkId}#${p.jev}`)).toEqual(['a.ts#input_unchecked_use#NG', 'b.ts#secret_logged#GOOD']);
  });

  it('limits each side to perSide', () => {
    const many = { files: Array.from({ length: 5 }, (_, i) => ({ path: `f${i}.ts`, checks: [check('error_empty_catch', 'NG'), check('secret_logged', 'GOOD')] })) };
    const pairs = pickPairs({ files: {} }, many, 'x', 2);
    expect(pairs.filter((p) => p.jev === 'NG')).toHaveLength(2);
    expect(pairs.filter((p) => p.jev === 'GOOD')).toHaveLength(2);
  });
});

describe('parseSheet', () => {
  const head = 'id\ttruth\tnote\tjev\tprobability\tcheckId\tlooksFor\tfile\turl';

  it('keeps filled rows and skips empty truth', () => {
    const tsv = [head, '1\tproblem\tL12 で握りつぶし\tNG\t0.8\terror_empty_catch\t…\ta.ts\tu', '2\t\t\tGOOD\t0.1\tsecret_logged\t…\tb.ts\tu', '3\tclean\t\tNG\t0.2\tinput_unchecked_use\t…\ta.ts\tu'].join('\n');
    expect(parseSheet(tsv)).toEqual({
      'a.ts': { error_empty_catch: { truth: 'problem', note: 'L12 で握りつぶし' }, input_unchecked_use: { truth: 'clean' } },
    });
  });

  it('rejects values other than problem and clean', () => {
    expect(() => parseSheet([head, '1\tyes\t\tNG\t0.8\terror_empty_catch\t…\ta.ts\tu'].join('\n'))).toThrow(/id 1/);
  });
});
