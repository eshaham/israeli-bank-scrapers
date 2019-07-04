const fs = require('fs');
const path = require('path');

function checkIfCoreVariation() {
  const packagePath = path.join(__dirname, '..', 'package.json');
  // eslint-disable-next-line import/no-dynamic-require,global-require
  const packageJson = require(packagePath);

  return (packageJson.name === 'israeli-bank-scrapers-core');
}

function updatePackageJson() {
  const packagePath = path.join(__dirname, '..', 'package.json');
  // eslint-disable-next-line import/no-dynamic-require,global-require
  const json = require(packagePath);

  json.dependencies['puppeteer-core'] = json.dependencies.puppeteer;
  delete json.dependencies.puppeteer;
  json.name = 'israeli-bank-scrapers-core';
  fs.writeFileSync(packagePath, JSON.stringify(json, null, '  '));

  console.log('change package.json name to \'israeli-bank-scrapers-core\' and use \'puppeteer-core\'');
}

(function () {
  if (checkIfCoreVariation()) {
    console.log('library is already in core variation');
    process.exit(1);
    return;
  }

  updatePackageJson();
}());
