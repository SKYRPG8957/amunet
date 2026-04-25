import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const outDir = path.join(root, 'src-tauri', 'binaries');
const outFile = path.join(outDir, 'luma-bridge-x86_64-pc-windows-msvc.exe');

await fs.mkdir(outDir, { recursive: true });

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = [
  '@yao-pkg/pkg',
  'server/index.mjs',
  '--targets',
  'node22-win-x64',
  '--output',
  outFile,
  '--public',
];

await new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      AMUNET_SERVE_STATIC: '0',
      AMUNET_TRUST_LOCAL_API: '1',
    },
  });

  child.on('error', reject);
  child.on('exit', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`bridge sidecar build failed with exit code ${code}`));
  });
});

console.log(`Built ${path.relative(root, outFile)}`);
