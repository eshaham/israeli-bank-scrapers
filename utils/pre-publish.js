const fsExtra = require('fs-extra');
const path = require('path');
const argv = require('minimist')(process.argv.slice(2), { string: 'version' });

const version = argv.version;

if (!version) {
    console.error(`missing argument 'version'`);
    process.exit(1);
    return;
}

const packageJSONPath = path.resolve(__dirname, '../package.json');

const packageJSON = fsExtra.readJSONSync(packageJSONPath);


packageJSON.version = version;
packageJSON.private = false;

fsExtra.writeJSONSync(packageJSONPath, packageJSON, { spaces: 2 })
