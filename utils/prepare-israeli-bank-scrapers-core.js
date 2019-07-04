const fs = require('fs');
const path = require('path');

const packagePath = path.join(__dirname, '..', 'package.json');
// eslint-disable-next-line import/no-dynamic-require
const json = require(packagePath);

json.dependencies['puppeteer-core'] = json.dependencies.puppeteer;
delete json.dependencies.puppeteer;
json.name = `${json.name}-core`;
fs.writeFileSync(packagePath, JSON.stringify(json, null, '  '));
