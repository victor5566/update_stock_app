// Usage: npm run build
// There is nothing to compile (plain Node backend, no-bundler frontend), so "build" is the pre-deploy
// check every deploy runs (deploy/remote.sh and the company_profiles repo's GitHub Actions workflow):
// it fails - and so stops the deploy - when the app would not start or would run broken.
// It doesn't connect to the database.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const errors = [];

// 1. Node version: >= 22.8.0, never v22.7.0 (UTF-8 JIT bug - see db.js / package.json engines).
const [major, minor] = process.versions.node.split('.').map(Number);
if (process.version === 'v22.7.0' || major < 22 || (major === 22 && minor < 8)) {
  errors.push(`Node ${process.version} is not supported - use >= 22.8.0 (and never v22.7.0)`);
}

// 2. Every JS file parses.
const jsFiles = ['server.js', 'db.js'];
for (const dir of ['lib', 'routes', 'scripts', 'public']) {
  for (const name of fs.readdirSync(path.join(ROOT, dir))) {
    if (name.endsWith('.js')) jsFiles.push(path.join(dir, name));
  }
}
for (const file of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', path.join(ROOT, file)], { stdio: 'pipe' });
  } catch (err) {
    errors.push(`syntax error in ${file}:\n${String(err.stderr).trim()}`);
  }
}

// 3. Dependencies are installed.
const { dependencies = {} } = require('../package.json');
for (const dep of Object.keys(dependencies)) {
  try {
    require.resolve(dep, { paths: [ROOT] });
  } catch {
    errors.push(`dependency ${dep} is not installed - run npm install first`);
  }
}

// 4. .env must be UTF-8: dotenv reads a UTF-16 file (what Windows PowerShell 5.1's `>` writes) as
// no settings at all, and the app then can't reach the database.
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  const head = fs.readFileSync(envPath).subarray(0, 2);
  if ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff)) {
    errors.push('.env is saved as UTF-16 - save it as UTF-8 (e.g. write it from WSL/bash, not PowerShell 5.1 `>`)');
  }
}

// 5. Database settings: a warning only, since they may come from the environment instead of .env.
try {
  require('dotenv').config({ path: path.join(ROOT, '.env') });
} catch {
  // dotenv missing is already reported above
}
const missingEnv = ['PGHOST', 'PGUSER', 'PGDATABASE'].filter((name) => !process.env[name]);
if (missingEnv.length) {
  console.warn(`WARNING: ${missingEnv.join(', ')} not set (no .env?) - the app won't reach the database`);
}

if (errors.length) {
  console.error(`Build check failed:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`Build check OK: Node ${process.version}, ${jsFiles.length} JS files, ${Object.keys(dependencies).length} dependencies`);
