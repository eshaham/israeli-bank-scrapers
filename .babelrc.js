const importVisitor = require('babel-plugin-import-visitor');
const packageJson = require('./package.json');

const presets = [
  [
    '@babel/preset-env',
    {
      targets: {
        node: '8',
      },
      useBuiltIns: "usage",
      corejs: "3"
    },
  ],
  "@babel/typescript"

];

module.exports = {
    presets,
    ignore: process.env.BABEL_ENV === 'test' ? [] : [
      '**/*.test.js',
      'tests/**/*',
    ],
  "plugins": [
    "@babel/plugin-proposal-class-properties",
    ["module-resolver", {
      "alias": {
        "@core/constants": () => "./src/constants",
        "@core/helpers": "./src/helpers",
        "@core/definitions": "./src/definitions",
        "^@core/(.+)": "./src/core/\\1",
      }
    }],
    importVisitor(node => {
      if (packageJson.name !== 'israeli-bank-scrapers-core') {
        return;
      }

      if (node.value === 'puppeteer') {
        node.value = 'puppeteer-core';
      }
    })
  ]
};
