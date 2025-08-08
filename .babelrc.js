module.exports = {
  presets: [['@babel/preset-env', { targets: { node: '18' } }], '@babel/preset-typescript'],
  ignore: ['**/*.test.(js,ts)', 'tests/**/*', 'src/tests/**/*'],
};
