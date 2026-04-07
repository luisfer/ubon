#!/usr/bin/env node

const { readFileSync } = require('fs');
const { join } = require('path');

const root = process.cwd();
const cliPath = join(root, 'src', 'cli.ts');
const docsPath = join(root, 'docs', 'CLI.md');

function extractLongFlags(optionDecl) {
  const matches = optionDecl.match(/--([a-z0-9-]+)/gi) || [];
  return matches.map((m) => m.replace(/^--/, '').toLowerCase());
}

function extractOptionDecls(text) {
  const out = [];
  const re = /\.option\(\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

function between(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) return '';
  const end = text.indexOf(endMarker, start);
  if (end === -1) return text.slice(start);
  return text.slice(start, end);
}

function toFlagSet(optionDecls) {
  return new Set(optionDecls.flatMap(extractLongFlags));
}

function parseCliExpectedFlags(cliText) {
  const commonBlock = between(cliText, 'const addCommonOptions = (cmd: Command): Command => {', '};\n\n// Scan command');
  const scanBlock = between(cliText, "const scanCmd = program", 'addCommonOptions(scanCmd).action');
  const checkBlock = between(cliText, "const checkCmd = program", 'addCommonOptions(checkCmd).action');

  const common = toFlagSet(extractOptionDecls(commonBlock));
  const scanSpecific = toFlagSet(extractOptionDecls(scanBlock));
  const checkSpecific = toFlagSet(extractOptionDecls(checkBlock));

  const scan = new Set([...common, ...scanSpecific]);
  const check = new Set([...common, ...checkSpecific]);
  return { scan, check };
}

function parseDocOptionsForCommand(docText, commandName) {
  const marker = `ubon ${commandName} [options]`;
  const start = docText.indexOf(marker);
  if (start === -1) return new Set();
  const optionsStart = docText.indexOf('Options:', start);
  if (optionsStart === -1) return new Set();
  const blockStart = docText.lastIndexOf('```', optionsStart);
  const blockEnd = docText.indexOf('```', optionsStart);
  if (blockStart === -1 || blockEnd === -1) return new Set();
  const block = docText.slice(optionsStart, blockEnd);
  const flags = new Set();
  for (const line of block.split('\n')) {
    const matches = line.match(/--([a-z0-9-]+)/gi) || [];
    matches.forEach((m) => flags.add(m.replace(/^--/, '').toLowerCase()));
  }
  return flags;
}

function diff(expected, actual) {
  const missing = [...expected].filter((f) => !actual.has(f)).sort();
  const extra = [...actual].filter((f) => !expected.has(f)).sort();
  return { missing, extra };
}

function formatDiff(command, d) {
  const lines = [];
  if (d.missing.length) lines.push(`  Missing in docs (${command}): ${d.missing.join(', ')}`);
  if (d.extra.length) lines.push(`  Extra in docs (${command}): ${d.extra.join(', ')}`);
  return lines;
}

const cliText = readFileSync(cliPath, 'utf8');
const docText = readFileSync(docsPath, 'utf8');
const expected = parseCliExpectedFlags(cliText);
const docScan = parseDocOptionsForCommand(docText, 'scan');
const docCheck = parseDocOptionsForCommand(docText, 'check');

const scanDiff = diff(expected.scan, docScan);
const checkDiff = diff(expected.check, docCheck);

const errors = [...formatDiff('scan', scanDiff), ...formatDiff('check', checkDiff)];

if (errors.length) {
  console.error('CLI docs drift detected:\n' + errors.join('\n'));
  process.exit(1);
}

console.log('CLI docs are in sync with src/cli.ts options.');
