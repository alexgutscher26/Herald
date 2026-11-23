/**
 * Keyword themes for free-text survey answers.
 *
 * This is deliberately not a model: it counts the words and two-word phrases
 * that recur across different respondents. A term counts once per response, so
 * one long answer cannot outvote ten short ones. The result is a ranking
 * operators can read, with the raw answers still one click away.
 *
 * English and Spanish stopwords are removed because the product ships both.
 * Purely numeric tokens are dropped: a rating belongs in the rating summary,
 * not in a theme list.
 */

const STOPWORDS = new Set(
  [
    // English
    "the", "and", "for", "but", "with", "without", "from", "this", "that",
    "these", "those", "there", "here", "have", "has", "had", "having", "was",
    "were", "been", "being", "are", "is", "am", "you", "your", "yours", "our",
    "ours", "their", "theirs", "his", "her", "hers", "its", "it", "they",
    "them", "we", "us", "i", "me", "my", "mine", "he", "she", "him", "who",
    "what", "when", "where", "why", "how", "would", "could", "should", "will",
    "can", "may", "might", "must", "not", "no", "yes", "just", "very", "too",
    "also", "only", "more", "most", "much", "many", "some", "any", "all",
    "every", "each", "other", "another", "such", "than", "then", "because",
    "about", "into", "over", "under", "after", "before", "again", "still",
    "even", "really", "quite", "like", "want", "wanted", "need", "needed",
    "use", "used", "using", "get", "got", "make", "made", "done", "does",
    "did", "doing", "one", "two", "now", "out", "off", "own", "same", "few",
    "lot", "lots", "bit", "good", "bad", "okay", "ok", "well", "wells",
    "thing", "things", "stuff", "please", "thanks", "thank", "hi", "hello",
    "wouldn", "couldn", "shouldn", "don", "doesn", "didn", "isn", "aren",
    "wasn", "weren", "won", "can", "cannot", "cant", "dont", "doesnt", "didnt",
    "isnt", "arent", "wasnt", "werent", "ive", "im", "youre", "youve", "weve",
    "theyre", "theres", "its", "let", "lets",
    // Spanish
    "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al",
    "a", "en", "y", "o", "que", "qué", "con", "sin", "por", "para", "pero",
    "como", "cómo", "más", "muy", "mi", "mis", "tu", "tus", "su", "sus", "me",
    "te", "se", "nos", "les", "lo", "le", "es", "son", "soy", "somos", "está",
    "están", "estoy", "estamos", "ser", "fue", "era", "han", "hay", "he",
    "has", "ha", "hemos", "si", "sí", "no", "ya", "también", "solo", "sólo",
    "cuando", "cuándo", "donde", "dónde", "porque", "sobre", "entre", "hasta",
    "desde", "este", "esta", "esto", "estos", "estas", "ese", "esa", "eso",
    "esos", "esas", "aquel", "aquella", "todo", "toda", "todos", "todas",
    "otro", "otra", "otros", "otras", "bien", "mal", "mucho", "mucha",
    "muchos", "muchas", "poco", "poca", "pocos", "pocas", "algo", "nada",
    "sería", "seria", "podría", "podria", "debería", "deberia", "hacer",
    "hace", "hacen", "tener", "tiene", "tienen", "gusta", "gustaría",
  ].filter(Boolean),
);

const TOKEN = /[\p{L}\p{N}]+/gu;
const NUMBER_ONLY = /^\p{N}+$/u;

export type KeywordTheme = {
  term: string;
  count: number;
  kind: "word" | "phrase";
};

function tokens(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .match(TOKEN) ?? [];
}

function usable(token: string): boolean {
  if (token.length < 3 || token.length > 32) return false;
  if (NUMBER_ONLY.test(token)) return false;
  return !STOPWORDS.has(token);
}

/**
 * Rank recurring terms across answers.
 *
 * Each response contributes at most one point per term. Two-word phrases are
 * built from adjacent usable tokens so "too expensive" survives as a theme
 * instead of leaving only "expensive" in the list.
 */
export function extractKeywordThemes(
  texts: readonly string[],
  limit = 10,
): KeywordTheme[] {
  const counts = new Map<string, { count: number; kind: "word" | "phrase" }>();

  for (const text of texts) {
    if (typeof text !== "string" || text.trim() === "") continue;
    const words = tokens(text);
    const seen = new Set<string>();

    const kept = words.filter(usable);
    for (const word of kept) {
      if (seen.has(word)) continue;
      seen.add(word);
      const current = counts.get(word) ?? { count: 0, kind: "word" as const };
      current.count += 1;
      counts.set(word, current);
    }

    for (let index = 0; index < words.length - 1; index += 1) {
      const left = words[index];
      const right = words[index + 1];
      if (left === undefined || right === undefined || !usable(left) || !usable(right)) continue;
      const phrase = `${left} ${right}`;
      if (seen.has(phrase)) continue;
      seen.add(phrase);
      const current = counts.get(phrase) ?? { count: 0, kind: "phrase" as const };
      current.count += 1;
      counts.set(phrase, current);
    }
  }

  return [...counts.entries()]
    .map(([term, value]) => ({ term, count: value.count, kind: value.kind }))
    .filter((theme) => theme.count > 1)
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      if (left.kind !== right.kind) return left.kind === "phrase" ? -1 : 1;
      return left.term.localeCompare(right.term);
    })
    .slice(0, Math.max(1, Math.min(30, Math.trunc(limit))));
}
