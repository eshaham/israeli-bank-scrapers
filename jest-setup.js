
try {
  require('./tests/tests-config');
} catch (e) {
  throw new Error(`Missing test configuration file './tests/tests-config.js' (did you remember to clone the template file './tests/tests-config.tpl.js' and set company credentials?)`);
}
