import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'fun-launch');
const mode = process.argv[2];
if (!['dev', 'start'].includes(mode)) throw new Error('Use serve.mjs dev or start.');
try { process.loadEnvFile(path.join(app, '.env.local')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
process.env.DEMO_DATA_DIR = path.resolve(root, process.env.DEMO_DATA_DIR || '.demo');
const require = createRequire(path.join(app, 'package.json'));
const children = [
  spawn(process.execPath, [path.join(root, 'scripts/token-search-worker.mjs')], { cwd: root, stdio: 'inherit', env: process.env }),
  spawn(process.execPath, [require.resolve('next/dist/bin/next'), mode, ...(mode === 'dev' ? ['--turbopack'] : []), '--hostname', '::', '--port', process.env.PORT || '3000'], { cwd: app, stdio: 'inherit', env: process.env }),
];
let stopping = false;
function stop(code) {
  if (stopping) return; stopping = true; process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => { for (const child of children) child.kill('SIGKILL'); }, 5000).unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));
for (const child of children) {
  child.on('error', () => stop(1));
  child.on('exit', code => { if (!stopping) stop(code || 1); });
}
