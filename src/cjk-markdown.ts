import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Unicode Character Property Checks for CJK characters and Punctuation/Symbols.
 */
const isPunct = (char: string) => /[\p{P}\p{S}]/u.test(char);
const isCjk = (char: string) =>
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char);

/**
 * Transform Markdown text to fix CJK punctuation emphasis bugs (CommonMark rule boundaries).
 *
 * In CommonMark:
 * - A closing delimiter (`**`, `*`, `~~`) cannot close emphasis if preceded by punctuation
 *   unless followed by whitespace or punctuation. When followed immediately by CJK characters,
 *   CommonMark fails to recognize it as a right-flanking delimiter run.
 * - An opening delimiter cannot open emphasis if followed by punctuation unless preceded by whitespace
 *   or punctuation.
 *
 * This transformer injects a space where needed at the visual boundary before Markdown rendering,
 * ensuring bold/italic/strikethrough styles are cleanly parsed and rendered in terminal output.
 */
export function transformCjkEmphasis(markdown: string): string {
  if (!markdown) return markdown;

  // 1. Protect code blocks, inline code, and LaTeX math formulas
  const placeholders: string[] = [];
  let text = markdown.replace(
    /(```[\s\S]*?```|`[^`\n]+`|\$\$[\s\S]*?\$\$|\$(?:\\.|[^\$\n\\])+\$)/g,
    (match) => {
      const idx = placeholders.length;
      placeholders.push(match);
      return `\x00BEAUTIFY_PROTECTED_${idx}\x00`;
    },
  );

  // 2. Fix Strong Emphasis (**...**)
  text = text.replace(/(\*\*)([^\n*]+?)(\*\*)/g, (fullMatch, _open, content, _close, offset, str) => {
    let result = fullMatch;
    const prevChar = offset > 0 ? str[offset - 1] : "";
    const nextChar = offset + fullMatch.length < str.length ? str[offset + fullMatch.length] : "";

    const startChar = content[0];
    const endChar = content[content.length - 1];

    if (isPunct(endChar) && isCjk(nextChar)) {
      result = result + " ";
    }
    if (isPunct(startChar) && isCjk(prevChar)) {
      result = " " + result;
    }
    return result;
  });

  // 3. Fix Emphasis (*...*) — exclude double asterisks
  text = text.replace(/(?<!\*)\*([^\n*]+?)\*(?!\*)/g, (fullMatch, content, offset, str) => {
    let result = fullMatch;
    const prevChar = offset > 0 ? str[offset - 1] : "";
    const nextChar = offset + fullMatch.length < str.length ? str[offset + fullMatch.length] : "";

    const startChar = content[0];
    const endChar = content[content.length - 1];

    if (isPunct(endChar) && isCjk(nextChar)) {
      result = result + " ";
    }
    if (isPunct(startChar) && isCjk(prevChar)) {
      result = " " + result;
    }
    return result;
  });

  // 4. Fix Strikethrough (~~...~~)
  text = text.replace(/(~~)([^\n~]+?)(~~)/g, (fullMatch, _open, content, _close, offset, str) => {
    let result = fullMatch;
    const prevChar = offset > 0 ? str[offset - 1] : "";
    const nextChar = offset + fullMatch.length < str.length ? str[offset + fullMatch.length] : "";

    const startChar = content[0];
    const endChar = content[content.length - 1];

    if (isPunct(endChar) && isCjk(nextChar)) {
      result = result + " ";
    }
    if (isPunct(startChar) && isCjk(prevChar)) {
      result = " " + result;
    }
    return result;
  });

  // 5. Restore protected regions
  return text.replace(/\x00BEAUTIFY_PROTECTED_(\d+)\x00/g, (_, i) => placeholders[Number(i)]);
}

/**
 * Register CJK Markdown transformer hook with Pi.
 */
export function registerCjkMarkdownTransformer(pi: ExtensionAPI): void {
  if (typeof pi.registerMarkdownTransformer !== "function") return;

  pi.registerMarkdownTransformer((markdown) => {
    try {
      return transformCjkEmphasis(markdown);
    } catch {
      return markdown;
    }
  });
}
