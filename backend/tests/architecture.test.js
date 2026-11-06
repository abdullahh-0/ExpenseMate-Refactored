/**
 * Architecture test: enforces the layered dependency rule
 *   Controller -> Service -> Repository -> Database
 * by inspecting what each layer is allowed to require().
 *
 * Services and repositories receive their collaborators by constructor injection; the only
 * place that wires them to the real database is container.js (the composition root).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function requiredModules(source) {
  const found = [];
  const pattern = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = pattern.exec(source))) found.push(match[1]);
  return found;
}

/** Returns the require() specifiers in `source` that match any forbidden pattern. */
function findViolations(source, forbidden) {
  return requiredModules(source).filter((mod) => forbidden.some((re) => re.test(mod)));
}

/** Removes /* block *\/ and // line comments so that only executable code is inspected. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function jsFiles(dir) {
  return fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f));
}

const DB = /(^|\/)db\/connection$|^pg$/;
const REPOSITORIES = /repositories\//;
const SERVICES = /services\//;
const CONTROLLERS = /controllers\//;
const HTTP = /^express$/;

// Only the features refactored in Assignment 2. Other controllers still talk to the DB directly.
const REFACTORED_CONTROLLERS = ['controllers/transactionController.js', 'controllers/budgetController.js'];

const RULES = [
  { layer: 'controllers (refactored)', files: REFACTORED_CONTROLLERS, forbidden: [DB, REPOSITORIES], why: 'controllers must call services, never SQL or repositories' },
  { layer: 'services', files: jsFiles('services'), forbidden: [DB, REPOSITORIES, CONTROLLERS, HTTP], why: 'services hold business rules only' },
  { layer: 'repositories', files: jsFiles('repositories'), forbidden: [SERVICES, CONTROLLERS, HTTP], why: 'repositories hold data access only' }
];

describe('layered architecture: Controller -> Service -> Repository -> Database', () => {
  test.each(RULES)('$layer respect the dependency rule ($why)', ({ files, forbidden }) => {
    expect(files.length).toBeGreaterThan(0);
    files.forEach((file) => {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf-8');
      expect({ file, violations: findViolations(source, forbidden) }).toEqual({ file, violations: [] });
    });
  });

  test('the composition root is the only module that wires repositories to the database', () => {
    const source = fs.readFileSync(path.join(ROOT, 'container.js'), 'utf-8');
    const mods = requiredModules(source);
    expect(mods.some((m) => DB.test(m))).toBe(true);
    expect(mods.some((m) => REPOSITORIES.test(m))).toBe(true);
    expect(mods.some((m) => SERVICES.test(m))).toBe(true);
  });

  test('the checker itself detects a violation (self-test)', () => {
    const bad = "const db = require('../db/connection');\nconst repo = require('../repositories/x');";
    expect(findViolations(bad, [DB, REPOSITORIES])).toEqual(['../db/connection', '../repositories/x']);
    expect(findViolations("const a = require('../errors/AppError');", [DB, REPOSITORIES])).toEqual([]);
  });

  test('repositories contain no business-calculation helpers', () => {
    // Heuristic guard: percentages/statuses are computed in services, never in repositories.
    jsFiles('repositories').forEach((file) => {
      const source = stripComments(fs.readFileSync(path.join(ROOT, file), 'utf-8'));
      expect(source).not.toMatch(/Math\.round|percentage|statusLabel|calculateBudgetStatus/);
    });
  });
});
