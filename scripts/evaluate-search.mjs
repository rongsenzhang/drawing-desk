import { readFileSync } from 'node:fs';
import { searchClauses } from '../app/engine.mjs';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const clauses = read('../data/clauses.json');
const queries = read('../tests/search-queries.json');
const rows = queries.map(({ query, expected }) => ({
  query, expected, returned: searchClauses(query, clauses, 3).map(row => row.id),
}));
const positive = rows.filter(r => r.expected);
const negative = rows.filter(r => !r.expected);
const result = {
  relevantQueries: positive.length,
  hitAt1: positive.filter(r => r.returned[0] === r.expected).length,
  hitAt3: positive.filter(r => r.returned.includes(r.expected)).length,
  unrelatedOrEmpty: negative.length,
  correctlyEmpty: negative.filter(r => !r.returned.length).length,
  rows,
};
console.log(JSON.stringify(result, null, 2));
