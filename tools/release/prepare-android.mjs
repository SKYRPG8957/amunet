import fs from 'node:fs/promises';

const APP_ID = 'app.luma.arcade';
const PRODUCT_NAME = 'Luma Arcade';

function versionCodeFrom(version) {
  const [major, minor, patch] = version.split(/[+-]/)[0].split('.').map((part) => Number(part));
  const run = Number(process.env.GITHUB_RUN_NUMBER || process.env.BUILD_NUMBER || 1) % 10000;
  return major * 100_000_000 + minor * 1_000_000 + patch * 10_000 + run;
}

async function replaceIfExists(file, replacers) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const [pattern, replacement] of replacers) {
    text = text.replace(pattern, replacement);
  }
  await fs.writeFile(file, text);
}

const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'));
const versionName = packageJson.version;
const versionCode = Number(process.env.ANDROID_VERSION_CODE || versionCodeFrom(versionName));
const gradleFile = 'android/app/build.gradle';

let gradle = await fs.readFile(gradleFile, 'utf8');

gradle = gradle
  .replace(/namespace\s+['"][^'"]+['"]/, `namespace "${APP_ID}"`)
  .replace(/applicationId\s+['"][^'"]+['"]/, `applicationId "${APP_ID}"`);

if (/versionCode\s+\d+/.test(gradle)) {
  gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
} else {
  gradle = gradle.replace(/defaultConfig\s*\{/, `defaultConfig {\n        versionCode ${versionCode}`);
}

if (/versionName\s+['"][^'"]+['"]/.test(gradle)) {
  gradle = gradle.replace(/versionName\s+['"][^'"]+['"]/, `versionName "${versionName}"`);
} else {
  gradle = gradle.replace(/defaultConfig\s*\{/, `defaultConfig {\n        versionName "${versionName}"`);
}

await fs.writeFile(gradleFile, gradle);

await replaceIfExists('android/app/src/main/res/values/strings.xml', [
  [/<string name="app_name">.*<\/string>/, `<string name="app_name">${PRODUCT_NAME}</string>`],
  [/<string name="title_activity_main">.*<\/string>/, `<string name="title_activity_main">${PRODUCT_NAME}</string>`],
]);

console.log(`Prepared Android ${PRODUCT_NAME} ${versionName} (${versionCode})`);
