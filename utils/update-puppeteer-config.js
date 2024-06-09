const fs = require('fs');
const path = require('path');

function getPuppeteerChromiumVersion() {
  const puppeteerLibrary = 'puppeteer-core' 
  const puppeteerPath = path.dirname(require.resolve(puppeteerLibrary));
  const revisionFilePath = path.join(puppeteerPath, 'revisions.js');
  // eslint-disable-next-line import/no-dynamic-require,global-require
  const revisionRaw = fs.readFileSync(revisionFilePath, 'utf-8');
  const [, revisionNumber] = revisionRaw.match(/chrome: ['"`](.+?)['"`][,]/);
  return revisionNumber;
}

(function updatePuppeteerConfiguration() {
  console.log('extract puppeteer chromium version from module \'puppeteer|pupetter-core\'');

  const chromiumRevision ="1250580"
  const configPath = path.join(__dirname, '../src/puppeteer-config.json');
  // eslint-disable-next-line global-require,import/no-dynamic-require
  const configJson = require(configPath);
  configJson.chromiumRevision = chromiumRevision;

  fs.writeFileSync(configPath, JSON.stringify(configJson, null, '  '));

  console.log(`update 'src/puppeteer-config.json' file with puppeteer chroumium revision '${chromiumRevision}'`);
}());
