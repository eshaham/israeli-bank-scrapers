/**
 * Pre-commit gate: gitleaks on staged changes.
 * Install gitleaks: https://github.com/gitleaks/gitleaks/releases
 * STRICT_GITLEAKS=1 — fail when gitleaks is missing (optional).
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function resolveGitleaksExecutable() {
  const exe = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks';
  const portable = path.join(repoRoot, 'node_modules', '.bin-tools', 'gitleaks', exe);
  if (fs.existsSync(portable)) {
    return portable;
  }
  return exe;
}

function tryGitleaksStaged() {
  const bin = resolveGitleaksExecutable();
  const attempts = [
    [bin, ['git', '--pre-commit', '--staged', '--config', '.gitleaks.toml', '--redact', '-v', '.']],
    [bin, ['protect', '--staged', '--config', '.gitleaks.toml', '--redact', '--verbose']],
  ];

  for (const [cmd, args] of attempts) {
    const res = spawnSync(cmd, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
    });
    if (res.error) {
      if (res.error.code === 'ENOENT') {
        continue;
      }
      console.error(res.error);
      process.exit(1);
    }
    process.exit(res.status === null ? 1 : res.status);
  }

  console.warn('[security] gitleaks not found in PATH.');
  console.warn('[security] Install: https://github.com/gitleaks/gitleaks/releases (Windows: winget install Gitleaks.Gitleaks)');
  if (process.env.STRICT_GITLEAKS === '1') {
    process.exit(1);
  }
  process.exit(0);
}

tryGitleaksStaged();
