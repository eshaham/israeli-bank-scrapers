const presets = [
  [
    "@babel/preset-env",
    {
      targets: {
        node: "8",
      },
      useBuiltIns: "usage",
      corejs: "3",
    },
  ],
  "@babel/preset-typescript",
];

module.exports = {
  presets,
  ignore: process.env.BABEL_ENV === "test" ? [] : ["**/*.test.(js,ts)", "tests/**/*", "src/tests/**/*"],
  plugins: ["@babel/plugin-proposal-class-properties"],
};
