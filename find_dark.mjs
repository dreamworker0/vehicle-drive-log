import fs from 'fs';
import path from 'path';

const SRC_DIR = './src/components';

const PATTERNS = [
  {
    name: 'bg missing dark',
    regex: /className=["'][^"']*?\bbg-(green|blue|red|amber|orange|purple|emerald)-[0-9]{2,3}\b[^"']*?["']/g,
    check: (match) => !match.includes('dark:bg-') && !match.includes('badge-') && !match.includes('btn-')
  },
  {
    name: 'text missing dark',
    regex: /className=["'][^"']*?\btext-(surface|gray)-(5|6|7|8|9)00\b[^"']*?["']/g,
    check: (match) => !match.includes('dark:text-')
  },
  {
    name: 'border missing dark',
    regex: /className=["'][^"']*?\bborder-(green|blue|red|amber|surface)-[12]00\b[^"']*?["']/g,
    check: (match) => !match.includes('dark:border-')
  }
];

function scanDir(dir) {
  const files = fs.readdirSync(dir);
  let results = [];
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      results = results.concat(scanDir(fullPath));
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      
      lines.forEach((line, index) => {
        PATTERNS.forEach(pattern => {
          let m;
          while ((m = pattern.regex.exec(line)) !== null) {
            if (pattern.check(m[0])) {
              results.push(`[${pattern.name}] ${fullPath.replace(/\\/g, '/')} : Line ${index + 1}
  => ${line.trim()}`);
            }
          }
        });
      });
    }
  }
  return results;
}

const issues = scanDir(SRC_DIR);
if (issues.length > 0) {
  console.log(`Found ${issues.length} potential dark mode missing classes:\n`);
  console.log(issues.join('\n\n'));
} else {
  console.log('No missing dark mode classes found!');
}
