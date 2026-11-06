/**
 * Rule-based automatic categorisation of a transaction description.
 *
 * The user can always override the suggestion manually.
 *
 * How a description is matched (and why it replaced the old substring search):
 *   1. The text is split into whole words, so "business" no longer contains the keyword "bus",
 *      "concert" no longer contains "cert", "training" no longer contains "train".
 *   2. Plural forms still match ("groceries" -> "grocery", "movies" -> "movie", "books" -> "book").
 *   3. A keyword may be several words ("client payment"); it must appear as a whole phrase.
 *   4. When several categories match, a longer phrase beats a single word ("store sales" is Business
 *      although "store" alone is Shopping); otherwise the rule listed first wins, as before.
 */

const FALLBACK_CATEGORY = 'Other';

const DEFAULT_RULES = [
  // Expense rules
  { category: 'Food', keywords: ['food', 'lunch', 'dinner', 'grocery', 'restaurant', 'cafe', 'coffee', 'mcdonald', 'pizza', 'burger', 'supermarket', 'kfc', 'subway', 'dining', 'eat'] },
  { category: 'Transport', keywords: ['uber', 'careem', 'fuel', 'petrol', 'bus', 'taxi', 'transport', 'train', 'flight', 'fare', 'vehicle', 'gasoline'] },
  { category: 'Shopping', keywords: ['clothes', 'clothing', 'amazon', 'shopping', 'shoes', 'electronics', 'mall', 'outfit', 'keyboard', 'laptop', 'store'] },
  { category: 'Bills', keywords: ['electricity', 'internet', 'mobile', 'phone', 'gas', 'bill', 'wifi', 'broadband', 'utility', 'utilities'] },
  { category: 'Education', keywords: ['book', 'course', 'university', 'tuition', 'education', 'udemy', 'school', 'fee', 'exam', 'cert', 'certificate', 'certification'] },
  { category: 'Health', keywords: ['doctor', 'medicine', 'pharmacy', 'hospital', 'health', 'clinic', 'lab', 'medical', 'dental'] },
  { category: 'Entertainment', keywords: ['movie', 'cinema', 'netflix', 'gaming', 'spotify', 'concert', 'show', 'ticket', 'steam', 'playstation'] },
  { category: 'Rent', keywords: ['rent', 'apartment', 'house', 'hostel', 'flat'] },

  // Income rules
  { category: 'Salary', keywords: ['salary', 'paycheck', 'payroll', 'wage', 'monthly pay'] },
  { category: 'Freelance', keywords: ['freelance', 'client payment', 'project payment', 'gig', 'upwork', 'fiverr'] },
  { category: 'Business', keywords: ['business', 'revenue', 'sales', 'profit', 'store sales'] },
  { category: 'Investment', keywords: ['dividend', 'stock', 'investment', 'crypto', 'return', 'interest'] }
];

/** Lower-cases the text and splits it into words made of letters and digits. */
function tokenize(text) {
  return String(text).toLowerCase().match(/[a-z0-9]+/g) || [];
}

/** The word itself plus its simple singular forms: "groceries" -> grocery, "buses" -> bus, "movies" -> movie. */
function wordForms(word) {
  const forms = [word];
  if (word.length > 3 && word.endsWith('ies')) forms.push(`${word.slice(0, -3)}y`);
  if (word.length > 3 && word.endsWith('es')) forms.push(word.slice(0, -2));
  if (word.length > 2 && word.endsWith('s')) forms.push(word.slice(0, -1));
  return forms;
}

class CategoryClassifier {
  /**
   * @param {{category:string, keywords:string[]}[]} [rules] ordered rules (order only breaks ties)
   * @param {string} [fallbackCategory] returned when nothing matches
   */
  constructor(rules = DEFAULT_RULES, fallbackCategory = FALLBACK_CATEGORY) {
    this.fallbackCategory = fallbackCategory;
    this.entries = [];

    rules.forEach((rule, ruleIndex) => {
      if (!rule || !rule.category || !Array.isArray(rule.keywords)) {
        throw new Error(`Invalid categorisation rule at position ${ruleIndex}`);
      }
      rule.keywords.forEach((keyword) => {
        const words = tokenize(keyword);
        if (words.length > 0) {
          this.entries.push({ category: rule.category, keyword: words.join(' '), words, ruleIndex });
        }
      });
    });
  }

  /**
   * Classifies a description.
   * @returns {{category:string, keyword:string|null}} the category and the keyword that decided it
   */
  classify(description) {
    if (typeof description !== 'string') return { category: this.fallbackCategory, keyword: null };

    const tokens = tokenize(description);
    const forms = tokens.map(wordForms);

    let best = null;
    for (const entry of this.entries) {
      if (!this.occursIn(entry.words, forms)) continue;
      if (best === null || this.isMoreSpecific(entry, best)) best = entry;
    }

    return best ? { category: best.category, keyword: best.keyword } : { category: this.fallbackCategory, keyword: null };
  }

  /** Name of the suggested category (the contract used by TransactionService and the importer). */
  suggestCategory(description) {
    return this.classify(description).category;
  }

  /** True when the keyword's words appear consecutively in the text (each word allowing singular forms). */
  occursIn(keywordWords, textForms) {
    for (let start = 0; start + keywordWords.length <= textForms.length; start++) {
      if (keywordWords.every((word, offset) => textForms[start + offset].includes(word))) return true;
    }
    return false;
  }

  /** Specificity order: a longer phrase wins; for equal length the earlier rule wins. */
  isMoreSpecific(candidate, current) {
    if (candidate.words.length !== current.words.length) return candidate.words.length > current.words.length;
    return candidate.ruleIndex < current.ruleIndex;
  }
}

module.exports = CategoryClassifier;
module.exports.DEFAULT_RULES = DEFAULT_RULES;
module.exports.FALLBACK_CATEGORY = FALLBACK_CATEGORY;
