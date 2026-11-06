const CategoryClassifier = require('../../services/categoryClassifier');
const legacy = require('../fixtures/legacyCategorizer');
const dataset = require('../fixtures/datasetSample');
const facade = require('../../utils/categorizer');

const classifier = new CategoryClassifier();
const suggest = (text) => classifier.suggestCategory(text);

describe('CategoryClassifier: matching whole words (the old substring search got these wrong)', () => {
  test.each([
    ['Concert tickets', 'Entertainment', 'Education'],     // "concert" contains "cert"
    ['Business revenue', 'Business', 'Transport'],         // "business" contains "bus"
    ['Training fee', 'Education', 'Transport'],            // "training" contains "train"
    ['Great dinner', 'Food', 'Food'],                      // (control: still Food, via "dinner")
    ['Great view', 'Other', 'Food'],                       // "great" contains "eat"
    ['Current account', 'Other', 'Rent'],                  // "current" contains "rent"
    ['Warehouse supplies', 'Other', 'Rent']                // "warehouse" contains "house"
  ])('"%s" -> %s (legacy gave %s)', (text, expected, legacyResult) => {
    expect(suggest(text)).toBe(expected);
    expect(legacy.suggestCategory(text)).toBe(legacyResult); // documents the old behaviour
  });
});

describe('CategoryClassifier: still understands normal descriptions', () => {
  test.each([
    ['Uber ride to campus', 'Transport'],
    ['Fuel & Car Refill', 'Transport'],
    ['Electricity Bill', 'Bills'],
    ['Lunch at KFC', 'Food'],
    ['Monthly Apartment Rent', 'Rent'],
    ['Software Engineer Salary', 'Salary'],
    ['Netflix subscription', 'Entertainment'],
    ['Doctor visit', 'Health'],
    ['UBER*TRIP #4821', 'Transport'],
    ['  pizza   night  ', 'Food']
  ])('"%s" -> %s', (text, expected) => {
    expect(suggest(text)).toBe(expected);
  });

  test.each([
    ['Groceries', 'Food'],
    ['Movies', 'Entertainment'],
    ['Textbooks and books', 'Education'],
    ['Buses', 'Transport'],
    ['Taxis', 'Transport'],
    ['Utilities', 'Bills']
  ])('plural "%s" -> %s', (text, expected) => {
    expect(suggest(text)).toBe(expected);
  });
});

describe('CategoryClassifier: phrases and tie-breaking', () => {
  test('a multi-word keyword must appear as a whole phrase', () => {
    expect(suggest('Client payment received')).toBe('Freelance');
    expect(suggest('Monthly pay')).toBe('Salary');
    expect(suggest('Payment from a client')).toBe('Other');
  });

  test('a longer phrase beats a single word ("store sales" is Business, "store" alone is Shopping)', () => {
    expect(suggest('Store sales')).toBe('Business');
    expect(suggest('Visited the store')).toBe('Shopping');
  });

  test('for equal length the earlier rule wins, so the result is predictable', () => {
    expect(suggest('Grocery shopping')).toBe('Food');      // Food is listed before Shopping
    expect(suggest('Fuel bill')).toBe('Transport');       // Transport is listed before Bills
  });

  test('classify() reports which keyword decided the category', () => {
    expect(classifier.classify('Concert tickets')).toEqual({ category: 'Entertainment', keyword: 'concert' });
    expect(classifier.classify('nothing relevant')).toEqual({ category: 'Other', keyword: null });
  });
});

describe('CategoryClassifier: fallback and invalid input', () => {
  test.each([[''], ['   '], ['xyz qqq'], [null], [undefined], [42], [{}]])('%p -> Other', (input) => {
    expect(suggest(input)).toBe('Other');
  });
});

describe('CategoryClassifier: configuration', () => {
  test('rules and fallback are injectable (no hard-coded values)', () => {
    const pets = new CategoryClassifier([{ category: 'Pets', keywords: ['dog food', 'vet'] }], 'Misc');
    expect(pets.suggestCategory('Dog food 10kg')).toBe('Pets');
    expect(pets.suggestCategory('Vets bill')).toBe('Pets');
    expect(pets.suggestCategory('food')).toBe('Misc');
  });

  test('an invalid rule is rejected when the classifier is created', () => {
    expect(() => new CategoryClassifier([{ category: 'X' }])).toThrow(/Invalid categorisation rule/);
    expect(() => new CategoryClassifier([null])).toThrow(/Invalid categorisation rule/);
  });

  test('the old function-style API still works through utils/categorizer', () => {
    expect(facade.suggestCategory('Uber ride')).toBe('Transport');
    expect(Array.isArray(facade.KEYWORD_RULES)).toBe(true);
  });
});

describe('Rewrite vs original on the labelled dataset (behaviour preserved, bugs fixed)', () => {
  const rowsWhere = (predicate) => dataset.filter(predicate).reduce((sum, d) => sum + d.rows, 0);

  test('the new classifier never loses a correct answer the original had', () => {
    const regressions = dataset.filter(
      (d) => legacy.suggestCategory(d.description) === d.label && suggest(d.description) !== d.label
    );
    expect(regressions).toEqual([]);
  });

  test('the only descriptions whose result changed are the substring false positives and one unmatched case', () => {
    const changed = dataset
      .filter((d) => legacy.suggestCategory(d.description) !== suggest(d.description))
      .map((d) => `${d.description}: ${legacy.suggestCategory(d.description)} -> ${suggest(d.description)}`)
      .sort();
    expect(changed).toEqual([
      'Business Revenue: Transport -> Business',
      'Concert: Education -> Entertainment',
      'Household Items: Rent -> Other',
      'Training Fee: Transport -> Education'
    ]);
  });

  test('accuracy over all 180 rows improves from 127 to 136', () => {
    const total = rowsWhere(() => true);
    const correctLegacy = rowsWhere((d) => legacy.suggestCategory(d.description) === d.label);
    const correctNew = rowsWhere((d) => suggest(d.description) === d.label);
    expect(total).toBe(180);
    expect(correctLegacy).toBe(127);
    expect(correctNew).toBe(136);
  });
});
