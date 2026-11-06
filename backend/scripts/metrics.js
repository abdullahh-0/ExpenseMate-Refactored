/**
 * Maintainability metrics for an ExpenseMate backend folder (works on the Assignment 1 baseline and on
 * the refactored version, so the two can be compared with identical measurements).
 *
 * Usage:  node scripts/metrics.js <path-to-backend>
 *
 * What is measured, per source folder (controllers, services, repositories, db, utils, errors, routes):
 *   - lines of code            non-blank lines
 *   - functions                number of functions/methods/arrow functions
 *   - max / avg complexity     cyclomatic complexity per function = 1 + number of decision points
 *                              (if, ?:, loops, case, catch, &&, ||, ??), found by parsing the code (AST)
 *   - longest function         in lines
 * and these dependency-separation indicators:
 *   - SQL calls in controllers    occurrences of  db.query( / pool.query(  inside controllers
 *   - files using the DB directly  application files (not db/, server.js, container.js) that require db/connection or pg
 *   - business logic in repos     repository files containing calculation helpers (Math.round, percentage)
 *
 * Tests, scripts, node_modules and one-off helper scripts in the backend root are not counted.
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');

const backend = path.resolve(process.argv[2] || '.');
if (!fs.existsSync(backend)) {
  console.error(`Folder not found: ${backend}`);
  process.exit(2);
}

const FOLDERS = ['controllers', 'services', 'repositories', 'db', 'utils', 'errors', 'routes'];
const ROOT_FILES = ['server.js', 'container.js'];

function listSourceFiles() {
  const files = [];
  FOLDERS.forEach((folder) => {
    const dir = path.join(backend, folder);
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).filter((f) => f.endsWith('.js')).forEach((f) => files.push({ group: folder, file: path.join(dir, f) }));
  });
  ROOT_FILES.forEach((f) => {
    const p = path.join(backend, f);
    if (fs.existsSync(p)) files.push({ group: 'root', file: p });
  });
  return files;
}

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod']);
const DECISION_TYPES = new Set(['IfStatement', 'ConditionalExpression', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement', 'CatchClause']);

/** Returns [{ complexity, lines }] for every function in the AST. */
function analyseFunctions(ast) {
  const found = [];

  function visit(node, current) {
    if (!node || typeof node.type !== 'string') return;
    let scope = current;
    if (FUNCTION_TYPES.has(node.type)) {
      scope = { complexity: 1, lines: node.loc.end.line - node.loc.start.line + 1 };
      found.push(scope);
    } else if (scope) {
      if (DECISION_TYPES.has(node.type)) scope.complexity++;
      else if (node.type === 'SwitchCase' && node.test) scope.complexity++;
      else if (node.type === 'LogicalExpression' && ['&&', '||', '??'].includes(node.operator)) scope.complexity++;
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach((c) => visit(c, scope));
      else if (child && typeof child === 'object') visit(child, scope);
    }
  }

  visit(ast.program, null);
  return found;
}

const stats = {};
const perFile = [];
let sqlCallsInControllers = 0;
const filesTalkingToDb = [];
const reposWithBusinessLogic = [];

for (const { group, file } of listSourceFiles()) {
  const source = fs.readFileSync(file, 'utf-8');
  const ast = parse(source, { sourceType: 'script', errorRecovery: true });
  const fns = analyseFunctions(ast);
  perFile.push({ group, name: path.relative(backend, file).replace(/\\/g, '/'), loc: source.split('\n').filter((l) => l.trim() !== '').length, calls: fns.length, max: Math.max(0, ...fns.map((f) => f.complexity)), longest: Math.max(0, ...fns.map((f) => f.lines)) });
  const g = (stats[group] = stats[group] || { files: 0, loc: 0, functions: 0, complexitySum: 0, maxComplexity: 0, longest: 0 });

  g.files++;
  g.loc += source.split('\n').filter((l) => l.trim() !== '').length;
  g.functions += fns.length;
  fns.forEach((f) => {
    g.complexitySum += f.complexity;
    g.maxComplexity = Math.max(g.maxComplexity, f.complexity);
    g.longest = Math.max(g.longest, f.lines);
  });

  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  if (group === 'controllers') sqlCallsInControllers += (code.match(/\b(db|pool)\.query\(/g) || []).length;
  // Application code that reaches the database by itself. The db/ folder (infrastructure), server.js (start-up)
  // and container.js (composition root, the one place that wires layers together) are expected to and not counted.
  const isInfrastructure = group === 'db' || ['server.js', 'container.js'].includes(path.basename(file));
  if (!isInfrastructure && /require\(\s*['"][^'"]*db\/connection['"]\s*\)|require\(\s*['"]pg['"]\s*\)/.test(code)) filesTalkingToDb.push(path.relative(backend, file).replace(/\\/g, '/'));
  if (group === 'repositories' && /Math\.round|percentage|statusLabel/.test(code)) reposWithBusinessLogic.push(path.basename(file));
}

const pad = (v, n) => String(v).padEnd(n);
const padL = (v, n) => String(v).padStart(n);
console.log(`Backend: ${backend}\n`);
console.log(`${pad('folder', 14)}${padL('files', 6)}${padL('LOC', 7)}${padL('functions', 11)}${padL('max cx', 8)}${padL('avg cx', 8)}${padL('longest fn', 12)}`);
let total = { files: 0, loc: 0, functions: 0, complexitySum: 0, maxComplexity: 0, longest: 0 };
Object.keys(stats).forEach((name) => {
  const s = stats[name];
  console.log(`${pad(name, 14)}${padL(s.files, 6)}${padL(s.loc, 7)}${padL(s.functions, 11)}${padL(s.maxComplexity, 8)}${padL(s.functions ? (s.complexitySum / s.functions).toFixed(1) : '-', 8)}${padL(s.longest, 12)}`);
  total = { files: total.files + s.files, loc: total.loc + s.loc, functions: total.functions + s.functions, complexitySum: total.complexitySum + s.complexitySum, maxComplexity: Math.max(total.maxComplexity, s.maxComplexity), longest: Math.max(total.longest, s.longest) };
});
console.log(`${pad('TOTAL', 14)}${padL(total.files, 6)}${padL(total.loc, 7)}${padL(total.functions, 11)}${padL(total.maxComplexity, 8)}${padL((total.complexitySum / total.functions).toFixed(1), 8)}${padL(total.longest, 12)}`);
console.log('\n(cx = cyclomatic complexity per function)\n');
console.log('Per file (controllers, services, repositories):');
console.log(`${pad('file', 38)}${padL('LOC', 6)}${padL('functions', 11)}${padL('max cx', 8)}${padL('longest fn', 12)}`);
perFile.filter((f) => ['controllers', 'services', 'repositories'].includes(f.group)).forEach((f) => {
  console.log(`${pad(f.name, 38)}${padL(f.loc, 6)}${padL(f.calls, 11)}${padL(f.max, 8)}${padL(f.longest, 12)}`);
});
console.log('');
console.log(`SQL calls inside controllers:      ${sqlCallsInControllers}`);
console.log(`Application files that use the DB directly: ${filesTalkingToDb.length}  -> ${filesTalkingToDb.join(', ') || 'none'}`);
console.log(`Repositories with business logic:   ${reposWithBusinessLogic.length}${reposWithBusinessLogic.length ? '  -> ' + reposWithBusinessLogic.join(', ') : ''}`);
