const fs = require('fs');
const content = fs.readFileSync('google-apps-script.md', 'utf8');
const lines = content.split('\n');
let jsCode = '';
let inCode = false;
for (const line of lines) {
  if (line.startsWith('```javascript')) {
    inCode = true;
    continue;
  }
  if (line.startsWith('```') && inCode) {
    inCode = false;
    break;
  }
  if (inCode) {
    jsCode += line + '\n';
  }
}
fs.writeFileSync('temp.js', jsCode);
console.log('Written to temp.js');
