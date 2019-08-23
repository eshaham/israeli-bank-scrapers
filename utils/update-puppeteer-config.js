const fs = require('fs');
const path = require('path');
const checkIfCoreVariation = require('./core-utils');

function getPuppeteerChromiumVersion() {
  const puppeteerLibrary = checkIfCoreVariation() ? 'puppeteer-core' : 'puppeteer';
  const puppeteerPath = path.dirname(require.resolve(puppeteerLibrary));
  const puppeteerPackagePath = path.join(puppeteerPath, 'package.json');
  // eslint-disable-next-line import/no-dynamic-require,global-require
  const puppeteerJson = require(puppeteerPackagePath);
  return puppeteerJson.puppeteer.chromium_revision;
}

(function updatePuppeteerConfiguration() {
  console.log('extract puppeteer chromium version from module \'puppeteer|pupetter-core\'');

  const chromiumRevision = getPuppeteerChromiumVersion();
  const configPath = path.join(__dirname, '../puppeteer-config.json');
  // eslint-disable-next-line global-require,import/no-dynamic-require
  const configJson = require(configPath);
  configJson.chromiumRevision = chromiumRevision;

  fs.writeFileSync(configPath, JSON.stringify(configJson, null, '  '));

  console.log(`update 'src/puppeteer-config.json' file with puppeteer chroumium revision '${chromiumRevision}'`);
}());
