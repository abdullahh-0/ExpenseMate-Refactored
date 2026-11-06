# ExpenseMate - Personal Expense Manager (Refactored)

Software Construction and Development (SCD) - Assignment 2: Software Evolution (Migration, Refactoring and Rewriting)

This repository is the evolved version of the Assignment 1 ExpenseMate application. The behaviour seen by the user is unchanged. The code underneath was migrated, refactored and partly rewritten.

## What Changed in Assignment 2

| Part | Change |
|---|---|
| A. Migration | `db/schema.sql` became versioned migrations in `db/migrations/`. A runner (`backend/db/migrate.js`) tracks them in a `schema_migrations` table. Migration 002 adds a `payment_method` column. A fingerprint script proves existing data is unchanged. |
| B. Refactoring | Transactions and budgets now follow Controller, Service, Repository, Database. Dependencies are wired in `backend/container.js`. A test enforces the layer rules. |
| C. Rewriting | `db/connection.js` was replaced by the classes `Database` and `MemoryDatabase`. The keyword categoriser was replaced by the class `CategoryClassifier`. |
| Extra feature | "Clear transaction history" button on the Transactions page (`DELETE /api/transactions?confirm=true`). |

Results: 6 tests in Assignment 1, 209 tests in 15 suites now; statement coverage 52.05% to 87.32% (measured at Stage E with 192 tests).

## Git Baseline and Branches

- Tag `a1-baseline`: the unchanged Assignment 1 code.
- Branch `assignment-2`: all Assignment 2 work.
- Tags `stageC-done`, `stageD-done`, `stageE-done`, `featureClear-done` mark the end of each stage.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 5, Chart.js |
| Backend | Node.js, Express 4 |
| Database | PostgreSQL (via pg), in-memory fallback |
| Testing | Jest, Supertest |

## Architecture

```text
Route  >  Controller  >  Service  >  Repository  >  Database (PostgreSQL or in-memory)
```

- Controllers read the request and write the response. No SQL and no business rules.
- Services hold validation and business rules.
- Repositories hold all SQL.
- `backend/container.js` creates and connects the layers.
- `backend/tests/architecture.test.js` fails if a layer calls the wrong neighbour.

Not yet refactored: the dashboard, import and category controllers still call the database directly.

## Project Structure

```text
ExpenseMate-Refactored/
|-- db/
|   |-- migrations/
|   |   |-- 001_baseline.sql
|   |   |-- 002_add_payment_method.sql
|   |   |-- 002_add_payment_method.down.sql
|   |-- seed.sql
|-- backend/
|   |-- controllers/            HTTP adapters
|   |-- services/               business rules (transaction, budget, category classifier)
|   |-- repositories/           all SQL
|   |-- errors/AppError.js      typed errors
|   |-- db/
|   |   |-- connection.js       facade
|   |   |-- Database.js         database class
|   |   |-- MemoryDatabase.js   in-memory engine
|   |   |-- config.js           connection settings
|   |   |-- migrate.js          migration runner
|   |   |-- fingerprint.js      before/after data check
|   |-- container.js            composition root
|   |-- routes/
|   |-- utils/                  validators and categoriser facade
|   |-- scripts/
|   |   |-- metrics.js          maintainability metrics
|   |   |-- regressionCompare.js  compares Assignment 1 and 2 backends
|   |-- tests/
|   |   |-- unit/               unit tests
|   |   |-- integration/        workflow and clear-history tests
|   |   |-- regression/         Assignment 1 tests, unchanged
|   |   |-- api.test.js, migrate.test.js, architecture.test.js
|   |-- server.js               entry point (port 5001)
|   |-- .env.example
|-- frontend/                   React (Vite) interface
|-- ExpenseMate_Dummy_Dataset_180.xlsx
```

## Prerequisites

- Node.js 18 or newer and npm
- PostgreSQL (optional). Without it the application starts in in-memory mode.

## Setup

1. Install the dependencies:

   ```bash
   cd backend
   npm install
   cd ../frontend
   npm install
   ```

2. Copy `backend/.env.example` to `backend/.env` and set your PostgreSQL password:

   ```text
   PORT=5001
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=expensemate_db
   DB_USER=postgres
   DB_PASSWORD=your_password
   DATABASE_URL=postgres://postgres:your_password@localhost:5432/expensemate_db
   ```

3. Create the database (skip this to use in-memory mode):

   ```sql
   CREATE DATABASE expensemate_db;
   ```

   Pending migrations are applied automatically when the server starts.

## Running the Application

### Option A: single server (production build)

```bash
cd frontend
npm run build
cd ../backend
npm start
```

Open http://localhost:5001

### Option B: development mode (two terminals)

Terminal 1:

```bash
cd backend
npm run dev
```

Terminal 2:

```bash
cd frontend
npm run dev
```

Open http://localhost:3000

## Database Migrations

Run these from the `backend` folder:

```bash
npm run migrate            # apply pending migrations
npm run migrate:status     # show applied and pending migrations
npm run migrate:down       # roll back the most recent migration
npm run db:fingerprint     # row counts, totals and content hash per table
```

To check that a migration keeps existing data intact, run `npm run db:fingerprint` before and after `npm run migrate` and compare the two outputs.

## Running the Tests

From the `backend` folder:

```bash
npm test                   # all suites
npm run test:coverage      # with coverage summary
```

Expected result: 15 suites, 209 tests, all passing. Two integration workflows that need PostgreSQL do nothing when the application runs in in-memory mode.

## Regression Comparison and Metrics

```bash
npm run metrics
npm run regression:compare -- <path to Assignment 1 backend> --edge
```

- `metrics` prints lines of code, functions, cyclomatic complexity and dependency-separation indicators.
- `regression:compare` starts the Assignment 1 backend and this backend on two fresh databases (`expensemate_cmp_a1` and `expensemate_cmp_a2`, created and dropped by the script), sends both the same requests and compares the responses. It needs PostgreSQL.

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | /api/categories | list categories |
| GET | /api/transactions | list transactions (search and filter options) |
| POST | /api/transactions | create a transaction (includes payment_method) |
| PUT | /api/transactions/:id | update a transaction |
| DELETE | /api/transactions/:id | delete one transaction |
| DELETE | /api/transactions?confirm=true | clear the whole transaction history |
| POST | /api/transactions/suggest-category | suggest a category from a description |
| GET | /api/budgets | budget summary with status |
| POST | /api/budgets | create or update a budget |
| DELETE | /api/budgets/:id | delete a budget |
| GET | /api/dashboard | dashboard totals and breakdowns |
| POST | /api/import/preview | upload and validate a spreadsheet |
| POST | /api/import/confirm | save the validated rows |
| GET | /api/export/csv | download all records as CSV |

Valid payment methods: Cash, Debit Card, Credit Card, Bank Transfer, Mobile Wallet.

Clear transaction history: the call is rejected unless `confirm=true` is sent. Budgets are kept and their spending resets to zero.

## Known Limitations

- The dashboard, import and category controllers still contain SQL (the import function has cyclomatic complexity 38).
- In in-memory mode the dashboard shows zeros.
- A category id that does not exist returns a generic 500 error instead of 400.
- Clearing history deletes transactions in every currency.

## Documentation

The Assignment 2 documents are submitted alongside the source: Migration Report, Refactoring Report, Rewriting Report, Test Package, Maintainability Comparison and Change Log, and Final Report.
