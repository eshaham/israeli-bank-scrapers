module.exports = {
  "rules": {
    "arrow-body-style": 0,
    "no-shadow": 0,
    "no-await-in-loop": 0,
    "no-underscore-dangle": 0,
    "max-classes-per-file": 0,
    "import/prefer-default-export": 0,
    "no-restricted-syntax": [
      "error",
      "ForInStatement",
      "LabeledStatement",
      "WithStatement"
    ],
    "operator-linebreak": ["error", "after"],
    "max-len": ["error", 100, 2, {
      "ignoreUrls": true,
      "ignoreComments": true,
      "ignoreRegExpLiterals": true,
      "ignoreStrings": true,
      "ignoreTemplateLiterals": true
    }],
    "linebreak-style": process.platform === "win32"? 0: 2,
  },
  "globals": {
    "document": true,
    "window": true,
    "fetch": true,
    "Headers": true
  },
  "env": {
    "jest": true
  },
  "parser": "babel-eslint",
  "extends": "airbnb-base"
}
