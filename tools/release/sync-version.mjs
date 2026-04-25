import fs from 'node:fs/promises';

const APP_ID = 'app.luma.arcade';
const PRODUCT_NAME = 'Luma Arcade';

function assertVersion(version) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid semver: ${version}`);
  }
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function replaceInFile(file, replacers) {
  let text = await fs.readFile(file, 'utf8');
  for (const [pattern, replacement] of replacers) {
    text = text.replace(pattern, replacement);
  }
  await fs.writeFile(file, text);
}

const packageJson = await readJson('package.json');
const requestedVersion = process.argv[2];

if (requestedVersion) {
  assertVersion(requestedVersion);
  packageJson.version = requestedVersion;
  await writeJson('package.json', packageJson);
}

const version = packageJson.version;
assertVersion(version);

try {
  const lock = await readJson('package-lock.json');
  lock.name = packageJson.name;
  lock.version = version;
  if (lock.packages?.['']) {
    lock.packages[''].name = packageJson.name;
    lock.packages[''].version = version;
  }
  await writeJson('package-lock.json', lock);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

await replaceInFile('capacitor.config.ts', [
  [/appId:\s*['"][^'"]+['"]/, `appId: '${APP_ID}'`],
  [/appName:\s*['"][^'"]+['"]/, `appName: '${PRODUCT_NAME}'`],
]);

const tauriConfig = await readJson('src-tauri/tauri.conf.json');
tauriConfig.productName = PRODUCT_NAME;
tauriConfig.version = version;
tauriConfig.identifier = APP_ID;
if (tauriConfig.app?.windows?.[0]) {
  tauriConfig.app.windows[0].title = PRODUCT_NAME;
}
await writeJson('src-tauri/tauri.conf.json', tauriConfig);

await replaceInFile('src-tauri/Cargo.toml', [
  [/^name = ".*"$/m, 'name = "luma-arcade-desktop"'],
  [/^version = ".*"$/m, `version = "${version}"`],
  [/^description = ".*"$/m, 'description = "Luma Arcade desktop shell"'],
  [/^authors = \[.*\]$/m, 'authors = ["Luma Arcade"]'],
]);

const manifest = await readJson('public/manifest.webmanifest');
manifest.name = PRODUCT_NAME;
manifest.short_name = 'Luma';
await writeJson('public/manifest.webmanifest', manifest);

await replaceInFile('index.html', [
  [/<title>.*<\/title>/, `<title>${PRODUCT_NAME}</title>`],
  [/content="[^"]*Minecraft Bedrock[^"]*"/, 'content="Luma Arcade - Minecraft Bedrock 멀티플레이 월드 탐색과 커뮤니티"'],
]);

console.log(`Synced ${PRODUCT_NAME} ${version}`);
