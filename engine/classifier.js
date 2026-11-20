// CLASSIFIER: categoría y marca. La categoría declarada por la fuente siempre gana; lo sugerido se marca como tal con su confianza.
import { cleanText, foldText, countWords } from './core/text.js';
import { CATEGORY_NAMES, KEYWORD_RULES, BRANDS } from './rules/categories.js';

const CANONICAL = new Map(CATEGORY_NAMES.map((name) => [foldText(name), name]));

// Reglas ordenadas por número de coincidencias; en empate gana la primera de la lista
function scoreRules(text, rules, wordsOf) {
  return rules
    .map((rule, order) => ({ rule, order, count: countWords(text, wordsOf(rule)) }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count || a.order - b.order);
}

/**
 * Devuelve category, category_source, category_confidence, category_declared (si no se reconoce),
 * brand y brand_source. Nunca deja de marcar el origen de cada dato.
 */
export function classify(record) {
  const text = foldText(`${record.product || ''} ${record.description || ''}`);
  const out = {};

  const declared = cleanText(record.category, 80);
  if (declared) {
    const canonical = CANONICAL.get(foldText(declared));
    if (canonical) {
      out.category = canonical;
      out.category_source = 'declarada';
      out.category_confidence = 1;
    } else {
      out.category = 'Otros';
      out.category_declared = declared;
      out.category_source = 'no reconocida';
      out.category_confidence = 0;
    }
  } else {
    const scored = scoreRules(text, KEYWORD_RULES, (r) => r.words);
    if (!scored.length) {
      out.category = 'Otros';
      out.category_source = 'sin pista';
      out.category_confidence = 0;
    } else {
      const tie = scored.length > 1 && scored[1].count === scored[0].count;
      out.category = scored[0].rule.category;
      out.category_source = 'sugerida';
      out.category_confidence = tie ? 0.4 : 0.6;
    }
  }

  const declaredBrand = cleanText(record.brand, 60);
  if (declaredBrand) {
    out.brand = declaredBrand;
    out.brand_source = 'declarada';
  } else {
    const scored = scoreRules(text, BRANDS, (r) => r.words);
    if (scored.length) {
      out.brand = scored[0].rule.brand;
      out.brand_source = 'sugerida';
      out.brand_confidence = 0.7;
    } else {
      out.brand = '';
      out.brand_source = 'sin dato';
    }
  }
  return out;
}
