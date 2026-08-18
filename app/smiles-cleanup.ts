export type SmilesCandidate = {
  value: string;
  fixes: string[];
};

export function splitSmilesInput(value: string) {
  return value
    .split(/\r?\n(?:[ \t]*\r?\n)+/)
    .map((group) => group.trim())
    .filter(Boolean);
}

const INVISIBLE_CHARACTERS = /[\u200B-\u200D\u2060\uFEFF]/g;
const UNICODE_DASHES = /[\u2010-\u2015\u2212]/g;
const UNICODE_DOTS = /[\u00B7\u2022\u2219\u22C5]/g;
const SMILES_LABEL = /^(?:(?:canonical\s+)?smiles?|smi)\s*(?::|=|\s)\s*/i;

function unique(values: string[]) {
  return [...new Set(values)];
}

function stripWrappingQuotes(value: string) {
  const pairs = [
    ["\"", "\""],
    ["'", "'"],
    ["`", "`"],
    ["“", "”"],
    ["‘", "’"],
  ] as const;

  for (const [opening, closing] of pairs) {
    if (value.startsWith(opening) && value.endsWith(closing) && value.length > 1) {
      return value.slice(opening.length, -closing.length).trim();
    }
  }
  return value;
}

export function makeSmilesCandidates(rawValue: string): SmilesCandidate[] {
  const candidates: SmilesCandidate[] = [];
  const seen = new Set<string>();
  const baseFixes: string[] = [];
  let value = rawValue;

  const compatibilityNormalized = value.normalize("NFKC");
  if (compatibilityNormalized !== value) baseFixes.push("normalized characters");
  value = compatibilityNormalized;

  const withoutInvisibleCharacters = value.replace(INVISIBLE_CHARACTERS, "");
  if (withoutInvisibleCharacters !== value) baseFixes.push("removed hidden characters");
  value = withoutInvisibleCharacters;

  const withStandardPunctuation = value
    .replace(UNICODE_DASHES, "-")
    .replace(UNICODE_DOTS, ".");
  if (withStandardPunctuation !== value) baseFixes.push("normalized punctuation");
  value = withStandardPunctuation;

  const trimmed = value.trim();
  if (trimmed !== value) baseFixes.push("trimmed whitespace");
  value = trimmed;

  const withoutLabel = value.replace(SMILES_LABEL, "");
  if (withoutLabel !== value) baseFixes.push("removed SMILES label");
  value = withoutLabel.trim();

  const withoutQuotes = stripWrappingQuotes(value);
  if (withoutQuotes !== value) baseFixes.push("removed wrapping quotes");
  value = withoutQuotes;

  const addCandidate = (candidateValue: string, fixes: string[]) => {
    const cleanValue = candidateValue.trim();
    if (!cleanValue || seen.has(cleanValue)) return;
    seen.add(cleanValue);
    candidates.push({ value: cleanValue, fixes: unique(fixes) });

    const withoutTrailingPunctuation = cleanValue.replace(/[,;]+$/, "");
    if (withoutTrailingPunctuation !== cleanValue && !seen.has(withoutTrailingPunctuation)) {
      seen.add(withoutTrailingPunctuation);
      candidates.push({
        value: withoutTrailingPunctuation,
        fixes: unique([...fixes, "removed trailing punctuation"]),
      });
    }
  };

  if (/\s/.test(value)) {
    addCandidate(value.replace(/\s+/g, ""), [...baseFixes, "removed spaces"]);

    const firstToken = value.match(/^(\S+)\s+.+$/)?.[1];
    if (firstToken) {
      addCandidate(firstToken, [...baseFixes, "removed trailing name"]);
    }
  }

  addCandidate(value, baseFixes);
  return candidates;
}
