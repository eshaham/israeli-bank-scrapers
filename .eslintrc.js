module.exports = {
  root: true,
  "rules": {
    "arrow-body-style": 0,
    "no-shadow": 0,
    "no-await-in-loop": 0,
    "no-restricted-syntax": [
      "error",
      "ForInStatement",
      "LabeledStatement",
      "WithStatement"
    ],
    "operator-linebreak": ["error", "after"],
    "max-len": ["error", 150, 2, {
      "ignoreUrls": true,
      "ignoreComments": true,
      "ignoreRegExpLiterals": true,
      "ignoreStrings": true,
      "ignoreTemplateLiterals": true
    }],
    "linebreak-style": process.platform === "win32"? 0: 2
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
  parserOptions:  {
    project: './tsconfig.json',
    ecmaVersion:  2018,  // Allows for the parsing of modern ECMAScript features
    sourceType:  'module',  // Allows for the use of imports
  },
  extends: ['airbnb-typescript/base']
}
