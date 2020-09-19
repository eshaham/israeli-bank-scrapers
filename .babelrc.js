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
      '**/*.test.(js,ts)',
      'tests/**/*',
      'src/tests/**/*',
    ],
  "plugins": []
};
