/**
 * Full-repo gitleaks scan (`npm run security:scan`).
 * Prefers portable binary under node_modules/.bin-tools/gitleaks/ when present.
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const exe = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks';
const portable = path.join(repoRoot, 'node_modules', '.bin-tools', 'gitleaks', exe);
const cmd = fs.existsSync(portable) ? portable : 'gitleaks';

const res = spawnSync(cmd, ['git', '-v', '--redact', '.'], {
  cwd: repoRoot,
  stdio: 'inherit',
});
process.exit(res.status === null ? 1 : res.status);
