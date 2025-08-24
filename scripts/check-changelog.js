const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const currentVersion = packageJson.version;

const changelogContent = fs.readFileSync(changelogPath, 'utf8');

const expectedHeader = `## ${currentVersion}`;

if (!changelogContent.includes(expectedHeader)) {
  console.error(`Error: CHANGELOG.md does not contain an entry for version ${currentVersion}.`);
  console.error(`Please add a header like "${expectedHeader}" to CHANGELOG.md before releasing.`);
  process.exit(1);
} else {
  console.log(`CHANGELOG.md contains entry for version ${currentVersion}.`);
}


