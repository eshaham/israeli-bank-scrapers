const fs = require('fs');
const path = require('path');

console.log('extract puppeteer chromium version from module \'puppeteer\'');

const puppeteerPath = path.dirname(require.resolve('puppeteer'));
const puppeteerPackagePath = path.join(puppeteerPath, 'package.json');
// eslint-disable-next-line import/no-dynamic-require
const puppeteerJson = require(puppeteerPackagePath);
const chromiumRevision = puppeteerJson.puppeteer.chromium_revision;

const configPath = path.join(__dirname, '..', 'src', 'puppeteer-config.json');
// eslint-disable-next-line import/no-dynamic-require
const configJson = require(configPath);
configJson.chromium_revision = chromiumRevision;

fs.writeFileSync(configPath, JSON.stringify(configJson, null, '  '));

console.log(`update 'src/puppeteer-config.json' file with puppeteer chroumium revision '${chromiumRevision}'`);
