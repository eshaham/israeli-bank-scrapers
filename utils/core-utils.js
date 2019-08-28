const path = require('path');

module.exports = function checkIfCoreVariation() {
  const packagePath = path.join(__dirname, '..', 'package.json');
  // eslint-disable-next-line import/no-dynamic-require,global-require
  const packageJson = require(packagePath);

  return (packageJson.name === 'israeli-bank-scrapers-core');
}
