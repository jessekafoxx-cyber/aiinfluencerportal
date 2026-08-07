export function stripMarkdownArtifacts(input: string | null | undefined): string {
  if (!input) return "";
  let s = String(input);
  s = s.replace(/\*\*(.+?)\*\*/g, "$1");
  s = s.replace(/\*(?!\*)([^*\n]+?)\*/g, "$1");
  s = s.replace(/__([^_\n]+?)__/g, "$1");
  s = s.replace(/^\s*#{1,6}\s+/gm, "");
  s = s.replace(/^\s*[-*+]\s+/gm, "• ");
  s = s.replace(/^\s*>+\s?/gm, "");
  s = s.replace(/^\s*[-*_]{3,}\s*$/gm, "");
  s = s.replace(/`{1,3}([^`\n]+?)`{1,3}/g, "$1");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}
