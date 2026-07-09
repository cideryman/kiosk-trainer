const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const sourceDir = 'gas';
const tempPath = 'temp.js';

const sourceFiles = fs.readdirSync(sourceDir)
  .filter(fileName => fileName.endsWith('.gs'))
  .sort();

if (sourceFiles.length === 0) {
  console.error(`No GAS source files found in ${sourceDir}.`);
  process.exit(1);
}

const jsCode = sourceFiles
  .map(fileName => fs.readFileSync(path.join(sourceDir, fileName), 'utf8').replace(/^\uFEFF/, ''))
  .join('\n');

fs.writeFileSync(tempPath, jsCode);

const result = spawnSync(process.execPath, ['--check', tempPath], {
  encoding: 'utf8',
});

fs.unlinkSync(tempPath);

if (result.status !== 0) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status || 1);
}

console.log(`GAS syntax check passed for ${sourceFiles.length} files.`);
