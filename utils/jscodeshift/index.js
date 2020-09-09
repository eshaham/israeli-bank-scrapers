const { resolve } = require('path');
const { spawnSync } = require('child_process');

module.exports = async function() {
    await spawnSync('jscodeshift',
        [
            '-t',
            resolve(__dirname, './puppeteer-imports.js'),
            resolve(__dirname, '../../src'),
            '--extensions',
            'ts',
            '--parser',
            'ts'
        ], {
            cwd: resolve(__dirname, '../../node_modules/.bin'),
            stdio: 'inherit'
        })

}