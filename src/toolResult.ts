export function shouldTruncateToolResult(toolName: string): boolean {
  return toolName.startsWith("kota_");
}
