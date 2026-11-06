/**
 * Backward-compatible entry point for automatic categorisation.
 * The logic now lives in services/categoryClassifier.js (class CategoryClassifier); this module
 * keeps the old function-style API for code that has not been migrated yet (e.g. the CSV importer).
 */
const CategoryClassifier = require('../services/categoryClassifier');

const classifier = new CategoryClassifier();

module.exports = {
  suggestCategory: (description) => classifier.suggestCategory(description),
  KEYWORD_RULES: CategoryClassifier.DEFAULT_RULES
};
