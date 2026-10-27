// Own temporary data outside Electron: Chromium still holds userData files at will-quit.
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function cleanup(directory, tempRoot) {
  // Only remove the unique directory this runner created inside the OS temp root.
  const target = path.resolve(directory);
  if (
    path.dirname(target) !== tempRoot ||
    !path.basename(target).startsWith('apex-electron-smoke-') ||
    (await fs.lstat(target)).isSymbolicLink()
  )
    throw new Error('Refusing cleanup outside the smoke-test temp directory.');
  await fs.rm(target, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 250,
  });
  console.log('PASS: smoke-test temporary data removed after Electron exited');
}

async function main() {
  const mode = process.argv[2];
  if (!['database', 'coverage'].includes(mode))
    throw new Error('Choose a smoke test: database or coverage.');
  const tempRoot = path.resolve(os.tmpdir());
  const directory = await fs.mkdtemp(
    path.join(tempRoot, 'apex-electron-smoke-'),
  );
  let result = 1;
  try {
    const environment = { ...process.env, APEX_SMOKE_USER_DATA: directory };
    delete environment.ELECTRON_RUN_AS_NODE;
    const child = spawn(
      require('electron'),
      [path.join(__dirname, `smoke-${mode}.cjs`), ...process.argv.slice(3)],
      { stdio: 'inherit', env: environment, windowsHide: true },
    );
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      console.error('Electron smoke test exceeded 120 seconds.');
      child.kill();
    }, 120000);
    try {
      result = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code) => resolve(timedOut ? 1 : (code ?? 1)));
      });
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await cleanup(directory, tempRoot);
  }
  process.exitCode = result;
}

main().catch((error) => {
  console.error('Smoke-test runner failed:', error);
  process.exitCode = 1;
});
