export const CODE_MAX_LENGTH = 16;

/** Приводит код к виду XXXX-XXXX-XXXX-XXXX. */
export function formatAccessCode(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_MAX_LENGTH);
  const parts: string[] = [];
  for (let i = 0; i < cleaned.length; i += 4) {
    parts.push(cleaned.slice(i, i + 4));
  }
  return parts.join("-");
}

export function isCodeComplete(formatted: string): boolean {
  return formatted.replace(/[^A-Z0-9]/gi, "").length === CODE_MAX_LENGTH;
}
