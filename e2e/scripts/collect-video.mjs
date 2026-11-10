// Copies the newest test video (and the newest downloaded ZIP) from test-results/ to artifacts/.
// Plain Node, no dependencies: node scripts/collect-video.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultsDir = path.join(root, 'test-results');
const artifactsDir = path.join(root, 'artifacts');

/** All files below `dir` whose name matches `test`, newest first. */
function findFiles(dir, test) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findFiles(full, test));
    else if (test(entry.name)) found.push({ file: full, mtime: fs.statSync(full).mtimeMs });
  }
  return found.sort((a, b) => b.mtime - a.mtime);
}

const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
fs.mkdirSync(artifactsDir, { recursive: true });

const [video] = findFiles(resultsDir, (name) => name === 'video.webm');
if (!video) {
  console.error(`No video.webm found under ${resultsDir}. Did the test run?`);
  process.exit(1);
}
const videoTarget = path.join(artifactsDir, `AtlasSync-E2E-${stamp}.webm`);
fs.copyFileSync(video.file, videoTarget);
console.log(`Video: ${videoTarget}`);

const [zip] = findFiles(path.join(resultsDir, 'artifacts'), (name) => name.toLowerCase().endsWith('.zip'));
if (zip) {
  const zipTarget = path.join(artifactsDir, `AtlasSync-E2E-${stamp}-${path.basename(zip.file)}`);
  fs.copyFileSync(zip.file, zipTarget);
  console.log(`ZIP:   ${zipTarget}`);
}
