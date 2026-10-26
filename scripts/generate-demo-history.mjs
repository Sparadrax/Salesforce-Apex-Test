import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runs = [
  ['2026-10-08', -0.12, 9],
  ['2026-10-11', -0.06, 11],
  ['2026-10-14', 0.02, 13],
  ['2026-10-17', -0.03, 15],
  ['2026-10-20', 0.08, 19],
  ['2026-10-23', 0.04, 23],
];
const generator = fileURLToPath(
  new URL('./generate-demo-deployment.mjs', import.meta.url),
);
for (const [index, [date, offset, failurePeriod]] of runs.entries()) {
  const result = spawnSync(
    process.execPath,
    [
      generator,
      '--date',
      date,
      '--run',
      String(51 + index),
      '--seed',
      date.replaceAll('-', ''),
      `--coverage-offset=${offset}`,
      '--failure-period',
      String(failurePeriod),
      '--output',
      `history/deployment-demo-${date}.json`,
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Generator failed for ${date}`);
}
