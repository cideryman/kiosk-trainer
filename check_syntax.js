const fs = require('fs');
const { spawnSync } = require('child_process');

const sourcePath = 'google-apps-script.md';
const tempPath = 'temp.js';

let content = fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, '');

const fencedCode = content.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
let jsCode = fencedCode ? fencedCode[1] : content;

jsCode = jsCode
  .replace(/^\s*\\\\javascript\s*\r?\n/, '')
  .replace(/^\s*\\javascript\s*\r?\n/, '');

fs.writeFileSync(tempPath, jsCode);

const result = spawnSync(process.execPath, ['--check', tempPath], {
  encoding: 'utf8',
});

if (result.status !== 0) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status || 1);
}

console.log(`GAS syntax check passed. Extracted source written to ${tempPath}.`);
