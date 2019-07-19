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
];

module.exports = {
    presets,
    ignore: process.env.BABEL_ENV === 'test' ? [] : [
      '**/*.test.js',
      'tests/**/*',
    ],
};
