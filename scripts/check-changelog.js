#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function fail(msg) {
  console.error(`❌ CHANGELOG check failed: ${msg}`);
  process.exit(1);
}

try {
  const pkgPath = path.join(process.cwd(), 'package.json');
  const changelogPath = path.join(process.cwd(), 'CHANGELOG.md');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const version = pkg.version;
  const changelog = fs.readFileSync(changelogPath, 'utf-8');
  const header = new RegExp(`^##\\s+${version}\\s+—`, 'm');
  if (!header.test(changelog)) {
    fail(`CHANGELOG.md does not contain a header for version ${version}`);
  }
  console.log(`✓ CHANGELOG contains entry for ${version}`);
} catch (e) {
  fail(e && e.message ? e.message : String(e));
}


