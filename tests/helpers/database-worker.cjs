// Source-level worker bootstrap: verifies production worker logic without a build.
require('tsx/cjs');
require('../../src/main/database/database-worker.ts');
