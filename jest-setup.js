
try {
  require('./tests/tests-config');
} catch (e) {
  throw new Error(`Missing test configuration file './tests/tests-config.js'. To troubleshot this issue open CONTRIBUTING.md file and read section 'F.A.Q regarding the tests'.`);
}
