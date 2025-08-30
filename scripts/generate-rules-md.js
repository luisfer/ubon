#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Try modular rules first, fallback to legacy
let RULES = {};

const modularRulesPath = path.join(__dirname, '..', 'dist', 'rules', 'index.js');
const legacyRulesPath = path.join(__dirname, '..', 'dist', 'types', 'rules.js');

if (fs.existsSync(modularRulesPath)) {
  console.log('Using modular rules system');
  const { RULES: modularRules } = require(modularRulesPath);
  RULES = modularRules;
} else if (fs.existsSync(legacyRulesPath)) {
  console.log('Using legacy rules system');
  const { RULES: legacyRules } = require(legacyRulesPath);
  RULES = legacyRules;
} else {
  console.error('No rules found. Run `npm run build` first.');
  process.exit(1);
}

function section(title) {
  return `\n### ${title}\n`;
}

const groups = {
  'Security (JS/TS)': [],
  'Next.js': [],
  'Accessibility': [],
  'Environment': [],
  'Links': [],
  'Python': [],
  'Vue': [],
  'Docker/CI': [],
  'Rails (experimental)': []
};

const nextExperimental = new Set(['NEXT201','NEXT202','NEXT203','NEXT205','NEXT208','NEXT209']);

Object.values(RULES).forEach(rule => {
  const id = rule.id;
  const line = `- ${id}: ${rule.message}${rule.helpUri ? ` ([docs](${rule.helpUri}))` : ''}`;
  if (id.startsWith('A11Y')) groups['Accessibility'].push(line);
  else if (id.startsWith('ENV')) groups['Environment'].push(line);
  else if (id.startsWith('LINK')) groups['Links'].push(line);
  else if (id.startsWith('PY')) groups['Python'].push(line);
  else if (id.startsWith('VUE')) groups['Vue'].push(line);
  else if (id.startsWith('DOCKER') || id.startsWith('GHA')) groups['Docker/CI'].push(line);
  else if (id.startsWith('RAILS')) groups['Rails (experimental)'].push(line);
  else if (id.startsWith('NEXT')) {
    if (nextExperimental.has(id)) groups['Rails (experimental)'].push(line.replace('Rails (experimental)','Next.js (experimental)'));
    else groups['Next.js'].push(line);
  } else {
    groups['Security (JS/TS)'].push(line);
  }
});

let out = '## Rules Glossary\n\n';
out += section('Security (JS/TS)') + groups['Security (JS/TS)'].sort().join('\n') + '\n';
out += section('Next.js') + groups['Next.js'].sort().join('\n') + '\n';
out += section('Accessibility') + groups['Accessibility'].sort().join('\n') + '\n';
out += section('Environment') + groups['Environment'].sort().join('\n') + '\n';
out += section('Links') + groups['Links'].sort().join('\n') + '\n';
out += section('Python') + groups['Python'].sort().join('\n') + '\n';
out += section('Vue') + groups['Vue'].sort().join('\n') + '\n';
out += section('Docker/CI') + groups['Docker/CI'].sort().join('\n') + '\n';
out += section('Rails (experimental)') + groups['Rails (experimental)'].sort().join('\n') + '\n';

const target = path.join(__dirname, '..', 'docs', 'RULES.md');
fs.writeFileSync(target, out.trim() + '\n');
console.log('RULES.md regenerated from code registry.');


