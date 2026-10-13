import fs from 'fs';

const path = 'AGENTS.md';
const text = fs.readFileSync(path, 'utf8');
const broken = '\u0007renaSize **4200**';
if (!text.includes(broken)) {
  console.log('marker missing');
  process.exit(1);
}
fs.writeFileSync(path, text.replace(broken, '`arenaSize` **4200**'));
console.log('fixed');
