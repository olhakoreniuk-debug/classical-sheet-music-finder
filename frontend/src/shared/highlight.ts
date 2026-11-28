// Splits text into matching and non-matching parts for search highlighting.
// Pure and case-insensitive; never produces HTML.

export interface TextPart {
  text: string;
  match: boolean;
}

export function splitHighlight(text: string, term: string): TextPart[] {
  const needle = term.trim().toLocaleLowerCase();
  if (!needle || !text) return [{ text, match: false }];

  const haystack = text.toLocaleLowerCase();
  // Lower-casing can change the length of some characters; fall back to no highlight then.
  if (haystack.length !== text.length) return [{ text, match: false }];

  const parts: TextPart[] = [];
  let from = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts;
}
