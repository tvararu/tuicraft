const COLOR_PATTERN = /\|c[0-9a-fA-F]{8}|\|r|\|H[^|]*\|h|\|h/g;

export function stripColorCodes(text: string): string {
  return text.replace(COLOR_PATTERN, "");
}
