export function truncateChars(input: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (input.length <= maxChars) return input;
  if (maxChars === 1) return "…";
  return input.slice(0, maxChars - 1) + "…";
}
