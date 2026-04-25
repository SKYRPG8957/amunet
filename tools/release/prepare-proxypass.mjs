import fs from 'node:fs/promises';
import path from 'node:path';

const url =
  process.env.AMUNET_PROXYPASS_URL ||
  'https://github.com/Kas-tle/ProxyPass/releases/latest/download/ProxyPass.jar';
const output = path.resolve('src-tauri/resources/ProxyPass.jar');

async function main() {
  await fs.mkdir(path.dirname(output), { recursive: true });

  if (process.env.AMUNET_PROXYPASS_FORCE !== '1') {
    try {
      const stat = await fs.stat(output);
      if (stat.isFile() && stat.size > 1_000_000) {
        console.log(`Using existing ${output}`);
        return;
      }
    } catch {
      // Download below.
    }
  }

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Luma-Arcade-Release' },
    signal: AbortSignal.timeout(180_000),
  });

  if (!response.ok) {
    throw new Error(`ProxyPass.jar download failed: HTTP ${response.status}`);
  }

  const temp = `${output}.download`;
  await fs.writeFile(temp, Buffer.from(await response.arrayBuffer()));
  await fs.rename(temp, output);
  console.log(`Prepared ${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
