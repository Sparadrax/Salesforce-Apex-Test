import { api } from '@electron-forge/core';
import path from 'node:path';

const artifacts = await api.make({
  dir: process.cwd(),
  outDir: path.resolve('out/coverage-fix'),
});
console.log(
  JSON.stringify(
    artifacts.map((result) => result.artifacts),
    null,
    2,
  ),
);
