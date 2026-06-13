/** Small, dependency-free extractors for parsing model output. */

/** Pull a single choice letter (A–E) from a model answer, given valid keys. */
export function extractChoiceLetter(text: string, validKeys: string[]): string | null {
  const keys = validKeys.map((k) => k.toUpperCase());
  const upper = text.toUpperCase();

  // Strongest signal: an explicit "answer is X" / "answer: X".
  const explicit = upper.match(/ANSWER\s*(?:IS|:)?\s*\(?\s*([A-E])\b/);
  if (explicit && keys.includes(explicit[1]!)) return explicit[1]!;

  // Otherwise the first standalone letter token that is a valid key.
  const token = upper.match(/\b([A-E])\b/);
  if (token && keys.includes(token[1]!)) return token[1]!;

  return null;
}

/** Extract the body of the first fenced code block, or the whole text if none. */
export function extractCodeBlock(text: string): string {
  const fence = text.match(/```(?:[a-zA-Z0-9]+)?\n([\s\S]*?)```/);
  if (fence) return fence[1]!.trim();
  return text.trim();
}

/** Safe JSON parse returning null instead of throwing. */
export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
