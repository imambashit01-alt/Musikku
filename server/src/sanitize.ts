export function stripControlCharacters(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 0x20 && (codePoint < 0x7f || codePoint > 0x9f);
    })
    .join("");
}
