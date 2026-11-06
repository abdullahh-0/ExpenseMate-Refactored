// Small test doubles shared by the unit tests (no database, no HTTP server needed).

/** Fake db: records every query; `responder(sql, params)` decides what comes back. */
function makeFakeDb(responder = () => ({ rows: [], rowCount: 0 })) {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return responder(sql, params);
    }
  };
}

/** Minimal Express response double. */
function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

module.exports = { makeFakeDb, makeRes };
