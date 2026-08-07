import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Strip leading/trailing Markdown code fences from an AI response.
 * Removes ```html, ```HTML, ```json, plain ``` etc. (with optional whitespace),
 * along with stray fences that AI models sometimes add at the end.
 */
export function stripCodeFences(input: string | null | undefined): string {
  if (!input) return "";
  let s = String(input).trim();
  // Strip leading fence: ```lang\n
  s = s.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, "");
  // Strip trailing fence: \n```
  s = s.replace(/\n?```\s*$/, "");
  // Strip any stray standalone fence lines anywhere in the body
  s = s.replace(/^\s*```[a-zA-Z0-9_-]*\s*$/gm, "");
  // Strip leaked markdown emphasis. The portal renders HTML, so any **bold**
  // or *italic* markdown left over from the model is unwanted noise.
  s = s.replace(/\*\*([^\n*][^\n*]*?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*\*/g, "");
  s = s.replace(/(^|[^*\w])\*(?!\s)([^\n*]+?)(?<!\s)\*(?!\w)/g, "$1<em>$2</em>");
  return s.trim();
}
