import { spawnSync } from "node:child_process";

import { CustomEditor, type AppKeybinding, type ExtensionAPI, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import { getKeybindings, Markdown, matchesKey, truncateToWidth, visibleWidth, type AutocompleteProvider, type EditorComponent, type EditorTheme, type TUI } from "@earendil-works/pi-tui";

interface Attachment {
  token: string;
  path: string;
}

const CLIPBOARD_PATH_RE = /(?:[^\s"'`<>]+[\\/])?pi-clipboard-[0-9a-f-]+\.(?:png|jpe?g|webp|gif)/gi;
const TOKEN_RE = /\[image(\d+)\]/g;
const TOKEN_LINE_RE = /\[image\d+\]/g;
const IMAGE_FILE_RE = /\.(?:png|jpe?g|webp|gif)$/i;
const MARKDOWN_PATCH_STATE = Symbol.for("pi-agent-beautify.markdown.patch");
const PLAIN_CODE_LANGS = new Set(["text", "plain", "plaintext"]);
const MACOS_CLIPBOARD_FILE_PATHS_SCRIPT = `
ObjC.import('AppKit');
ObjC.import('Foundation');
const pb = $.NSPasteboard.generalPasteboard;
const classes = $.NSArray.arrayWithObject($.NSURL);
const options = $.NSDictionary.dictionaryWithObjectForKey($.NSNumber.numberWithBool(true), $.NSPasteboardURLReadingFileURLsOnlyKey);
const urls = pb.readObjectsForClassesOptions(classes, options);
const paths = [];
if (urls) {
  for (let i = 0; i < urls.count; i++) {
    const url = urls.objectAtIndex(i);
    if (url.isFileURL) paths.push(ObjC.unwrap(url.path));
  }
}
JSON.stringify(paths);
`;

interface MarkdownCodeToken {
  type: "code";
  lang?: string;
  text?: string;
}

interface MarkdownHeadingToken {
  type: "heading";
  depth: number;
  tokens?: unknown[];
}

interface BeautifyMarkdownTheme {
  heading: (text: string) => string;
  bold: (text: string) => string;
  italic: (text: string) => string;
  underline: (text: string) => string;
  hr: (text: string) => string;
  codeBlock: (text: string) => string;
  codeBlockBorder: (text: string) => string;
  codeBlockIndent?: string;
  highlightCode?: (code: string, lang?: string) => string[];
}

interface InlineStyleContext {
  applyText: (text: string) => string;
  stylePrefix: string;
}

interface MarkdownRuntime {
  theme: BeautifyMarkdownTheme;
  applyDefaultStyle?: (text: string) => string;
  getStylePrefix?: (styleFn: (text: string) => string) => string;
  renderInlineTokens?: (tokens: unknown[], styleContext?: InlineStyleContext) => string;
}

type MarkdownRenderToken = (this: MarkdownRuntime, token: unknown, width: number, nextTokenType?: string, styleContext?: unknown) => string[];

interface MarkdownPatchState {
  installed: true;
  original: MarkdownRenderToken;
  /** Background painter matching tool-execution panels (e.g. theme.bg("toolPendingBg", ...)). */
  codeBlockBg?: (text: string) => string;
  renderCodeToken: (instance: MarkdownRuntime, token: MarkdownCodeToken, width: number, nextTokenType?: string) => string[];
  renderHeadingToken: (instance: MarkdownRuntime, token: MarkdownHeadingToken, width: number, nextTokenType?: string) => string[];
}

type PatchedMarkdownPrototype = {
  renderToken?: MarkdownRenderToken;
  [key: symbol]: unknown;
};

function isMarkdownCodeToken(token: unknown): token is MarkdownCodeToken {
  return typeof token === "object" && token !== null && (token as { type?: unknown }).type === "code";
}

function isMarkdownHeadingToken(token: unknown): token is MarkdownHeadingToken {
  return typeof token === "object" && token !== null && (token as { type?: unknown }).type === "heading";
}

/**
 * Paint a code line with the same kind of solid background used by tool-execution panels.
 * Pads to `width` so the bar reads as a block; no border glyphs (copy stays clean).
 */
function paintCodeLine(text: string, width: number, bgFn?: (text: string) => string): string {
  if (!bgFn) return text;
  const pad = Math.max(0, width - visibleWidth(text));
  return bgFn(text + " ".repeat(pad));
}

function renderCodeTokenWithoutFences(
  instance: MarkdownRuntime,
  token: MarkdownCodeToken,
  width: number,
  nextTokenType?: string,
): string[] {
  const raw = typeof token.text === "string" ? token.text : "";
  const langRaw = typeof token.lang === "string" ? token.lang.trim() : "";
  const lang = langRaw.toLowerCase();
  const lines: string[] = [];
  const indent = instance.theme.codeBlockIndent ?? "  ";
  const proto = Markdown.prototype as unknown as PatchedMarkdownPrototype;
  const bgFn = (proto[MARKDOWN_PATCH_STATE] as MarkdownPatchState | undefined)?.codeBlockBg;
  const w = Math.max(1, width);

  // text/plain fences: still no syntax-highlight chrome, but use the same panel
  // background — these blocks are often used for emphasis / expected output.
  let contentLines: string[];
  if (PLAIN_CODE_LANGS.has(lang)) {
    contentLines = raw.split("\n").map((line) => instance.applyDefaultStyle?.(line) ?? line);
  } else if (instance.theme.highlightCode) {
    contentLines = instance.theme.highlightCode(raw, token.lang);
  } else {
    contentLines = raw.split("\n").map((line) => instance.theme.codeBlock(line));
  }

  // No raw ``` fences, no box-drawing glyphs.
  // Tool-panel background + light indent keeps blocks distinct and copy-safe.
  lines.push(paintCodeLine("", w, bgFn));
  if (contentLines.length === 0) {
    lines.push(paintCodeLine(indent, w, bgFn));
  } else {
    for (const line of contentLines) lines.push(paintCodeLine(`${indent}${line}`, w, bgFn));
  }
  lines.push(paintCodeLine("", w, bgFn));

  if (nextTokenType && nextTokenType !== "space") lines.push("");
  return lines;
}

/**
 * Build a level-aware style for natural heading rendering (no raw "#" markers).
 * Hierarchy is expressed with weight / underline / italic / indent / rule lines.
 */
function createHeadingStyleFn(theme: BeautifyMarkdownTheme, level: number): (text: string) => string {
  switch (level) {
    case 1:
      // Strongest: bold (underline comes from the dedicated rule line)
      return (text) => theme.heading(theme.bold(text));
    case 2:
      // Major section: bold
      return (text) => theme.heading(theme.bold(text));
    case 3:
      // Subsection: heading color only (no bold)
      return (text) => theme.heading(text);
    case 4:
      // Nested: italic heading color
      return (text) => theme.heading(theme.italic(text));
    case 5:
      // Deep: dimmer via hr palette + italic
      return (text) => theme.hr(theme.italic(text));
    default:
      // Deepest: quietest
      return (text) => theme.hr(theme.italic(text));
  }
}

/** Left indent grows with depth so nested sections are easy to scan. */
function headingIndent(level: number): string {
  // Keep H1/H2 flush-left; start indenting from H3 so top titles dominate.
  if (level <= 2) return "";
  return "  ".repeat(level - 2);
}

/**
 * Optional level marker that is NOT the raw markdown "#".
 * Keeps hierarchy readable without looking like unrendered source.
 */
function headingMarker(theme: BeautifyMarkdownTheme, level: number): string {
  switch (level) {
    case 1:
      // Distinct badge so H1 is instantly recognizable in monochrome terminals too
      return theme.heading(theme.bold("◆ "));
    case 2:
      return theme.heading(theme.bold("▸ "));
    case 3:
      return theme.heading("> ");
    case 4:
      return theme.hr("- ");
    case 5:
    default:
      return theme.hr(". ");
  }
}

/** Visible width without ANSI escape sequences. */
function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

/**
 * Decorative underline under H1 / H2.
 * Uses heading color (not dim hr) so the rule actually stands out on dark themes.
 */
function headingRule(
  theme: BeautifyMarkdownTheme,
  level: number,
  width: number,
  titleVisibleWidth: number,
): string | undefined {
  if (level !== 1 && level !== 2) return undefined;
  // Fit the rule to the title when possible; fall back to a readable fixed span.
  const preferred = level === 1 ? Math.max(titleVisibleWidth, 12) : Math.max(titleVisibleWidth, 10);
  const ruleWidth = Math.max(8, Math.min(width, preferred));
  const ch = level === 1 ? "═" : "─";
  // heading color keeps the rule on the same palette as the title
  return theme.heading(ch.repeat(ruleWidth));
}

/**
 * Render headings as styled text without raw markdown markers.
 * Upstream pi-tui already hides "#" / "##" for h1/h2, but still prints
 * "###"… markers for h3+. This normalizes every level to natural heading style
 * and adds a clear visual hierarchy across H1–H6.
 */
function renderHeadingTokenNatural(
  instance: MarkdownRuntime,
  token: MarkdownHeadingToken,
  width: number,
  nextTokenType?: string,
): string[] {
  const headingLevel = Math.max(1, Math.min(6, Number(token.depth) || 1));
  const headingStyleFn = createHeadingStyleFn(instance.theme, headingLevel);
  const indent = headingIndent(headingLevel);

  const headingStyleContext: InlineStyleContext = {
    applyText: headingStyleFn,
    stylePrefix: instance.getStylePrefix?.(headingStyleFn) ?? "",
  };

  // No raw "#" markers — use styled hierarchy (indent / weight / glyph / rule).
  const headingText = instance.renderInlineTokens?.(token.tokens || [], headingStyleContext) ?? "";
  const marker = headingMarker(instance.theme, headingLevel);
  const titleLine = `${indent}${marker}${headingText}`;
  const lines: string[] = [titleLine];

  const titleVisibleWidth = stripAnsi(`${marker}${headingText}`).length;
  const rule = headingRule(
    instance.theme,
    headingLevel,
    Math.max(1, width - indent.length),
    titleVisibleWidth,
  );
  if (rule) lines.push(`${indent}${rule}`);

  // Extra breathing room after top-level headings
  if (headingLevel <= 2) {
    if (nextTokenType && nextTokenType !== "space") lines.push("");
  } else if (nextTokenType && nextTokenType !== "space") {
    lines.push("");
  }
  return lines;
}

function installMarkdownBeautifyPatch(): void {
  const proto = Markdown.prototype as unknown as PatchedMarkdownPrototype;
  const existing = proto[MARKDOWN_PATCH_STATE] as MarkdownPatchState | undefined;
  if (existing?.installed) {
    existing.renderCodeToken = renderCodeTokenWithoutFences;
    existing.renderHeadingToken = renderHeadingTokenNatural;
    return;
  }

  const original = proto.renderToken;
  if (typeof original !== "function") return;

  const state: MarkdownPatchState = {
    installed: true,
    original,
    renderCodeToken: renderCodeTokenWithoutFences,
    renderHeadingToken: renderHeadingTokenNatural,
  };
  proto[MARKDOWN_PATCH_STATE] = state;

  proto.renderToken = function (this: MarkdownRuntime, token: unknown, width: number, nextTokenType?: string, styleContext?: unknown): string[] {
    const current = proto[MARKDOWN_PATCH_STATE] as MarkdownPatchState | undefined;
    if (current && isMarkdownHeadingToken(token)) return current.renderHeadingToken(this, token, width, nextTokenType);
    if (current && isMarkdownCodeToken(token)) return current.renderCodeToken(this, token, width, nextTokenType);
    return (current?.original ?? original).call(this, token, width, nextTokenType, styleContext);
  };
}

function imageChip(id: number): string {
  return `[image${id}]`;
}

function displayChip(token: string, theme: Theme): string {
  return theme.fg("toolDiffAdded", theme.inverse(token));
}

function readClipboardFilePaths(): string[] {
  if (process.platform !== "darwin") return [];

  const result = spawnSync("osascript", ["-l", "JavaScript", "-e", MACOS_CLIPBOARD_FILE_PATHS_SCRIPT], {
    encoding: "utf8",
    timeout: 700,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) return [];

  try {
    const parsed: unknown = JSON.parse(result.stdout.trim() || "[]");
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.filter((path): path is string => {
      if (typeof path !== "string" || path.length === 0 || seen.has(path)) return false;
      seen.add(path);
      return true;
    });
  } catch {
    return [];
  }
}

function pasteClipboardFilePaths(editor: EditorComponent, imageTokens: ImageTokenController, tui: TUI): boolean {
  const paths = readClipboardFilePaths();
  if (paths.length === 0) return false;

  const text = imageTokens.formatClipboardFilePaths(paths, editor.getText());
  if (!text) return false;

  if (editor.insertTextAtCursor) {
    editor.insertTextAtCursor(text);
  } else {
    editor.setText(editor.getText() + text);
    editor.onChange?.(editor.getText());
  }
  tui.requestRender();
  return true;
}

interface EditorInternals {
  state: { lines: string[]; cursorLine: number; cursorCol: number };
  historyIndex: number;
  lastAction: string | null;
  pushUndoSnapshot: () => void;
  setCursorCol: (col: number) => void;
}

class ImageTokenController {
  constructor(private readonly attachments: Map<string, Attachment>) {}

  renderChips(lines: string[], theme: Theme, width: number): string[] {
    let rendered = lines;
    for (const attachment of this.attachments.values()) {
      rendered = rendered.map((line) => line.replaceAll(attachment.token, displayChip(attachment.token, theme)));
    }
    return rendered.map((line) => truncateToWidth(line, width, ""));
  }

  replaceClipboardPathsInText(text: string, existingText = ""): string {
    const usedIds = this.collectUsedIds(`${existingText}\n${text}`);
    return text.replace(CLIPBOARD_PATH_RE, (path) => this.createImageToken(path, usedIds));
  }

  formatClipboardFilePaths(paths: string[], existingText = ""): string {
    const usedIds = this.collectUsedIds(existingText);
    const pieces = paths.map((path) => (IMAGE_FILE_RE.test(path) ? this.createImageToken(path, usedIds) : path));
    return pieces.join(paths.length > 1 ? "\n" : "");
  }

  replaceClipboardPathsInEditor(editor: EditorComponent, tui: TUI): void {
    const current = editor.getText();
    const usedIds = this.collectUsedIds(current);
    let changed = false;
    const next = current.replace(CLIPBOARD_PATH_RE, (path) => {
      changed = true;
      return this.createImageToken(path, usedIds);
    });
    if (!changed) return;
    editor.setText(next);
    tui.requestRender();
  }

  deleteImageTokenAtCursor(editor: EditorComponent, data: string, tui: TUI): boolean {
    const keybindings = getKeybindings();
    const backward = keybindings.matches(data, "tui.editor.deleteCharBackward") || matchesKey(data, "shift+backspace");
    const forward = keybindings.matches(data, "tui.editor.deleteCharForward") || matchesKey(data, "shift+delete");
    if (!backward && !forward) return false;

    const writableEditor = editor as unknown as Partial<EditorInternals>;
    if (!writableEditor.state || !writableEditor.pushUndoSnapshot || !writableEditor.setCursorCol) return false;

    const line = writableEditor.state.lines[writableEditor.state.cursorLine] || "";
    const range = this.findImageTokenDeleteRange(line, writableEditor.state.cursorCol, backward);
    if (!range) return false;

    writableEditor.historyIndex = -1;
    writableEditor.lastAction = null;
    writableEditor.pushUndoSnapshot();
    writableEditor.state.lines[writableEditor.state.cursorLine] = line.slice(0, range.start) + line.slice(range.end);
    writableEditor.setCursorCol(range.start);
    this.attachments.delete(range.token);
    editor.onChange?.(editor.getText());
    tui.requestRender();
    return true;
  }

  private findImageTokenDeleteRange(line: string, cursorCol: number, backward: boolean): { start: number; end: number; token: string } | undefined {
    for (const match of line.matchAll(TOKEN_LINE_RE)) {
      const token = match[0];
      const start = match.index;
      let end = start + token.length;
      if (backward) {
        if (start < cursorCol && cursorCol <= end) return { start, end, token };
        if (cursorCol === end + 1 && line[end] === " ") return { start, end: end + 1, token };
      } else if (start <= cursorCol && cursorCol < end) {
        if (line[end] === " ") end += 1;
        return { start, end, token };
      }
    }
    return undefined;
  }

  private collectUsedIds(text: string): Set<number> {
    const usedIds = new Set<number>();
    for (const match of text.matchAll(TOKEN_RE)) usedIds.add(Number(match[1]));
    return usedIds;
  }

  private createImageToken(path: string, usedIds: Set<number>): string {
    let id = 1;
    while (usedIds.has(id)) id++;
    usedIds.add(id);
    const token = imageChip(id);
    this.attachments.set(token, { token, path });
    return token;
  }
}

class BeautifyEditor extends CustomEditor {
  private scanTimers: Array<ReturnType<typeof setTimeout>> = [];

  constructor(
    tui: TUI,
    theme: EditorTheme,
    private readonly appKeybindings: KeybindingsManager,
    private readonly imageTokens: ImageTokenController,
    private readonly getTheme: () => Theme,
  ) {
    super(tui, theme, appKeybindings);
  }

  handleInput(data: string): void {
    const isImagePaste = this.appKeybindings.matches(data, "app.clipboard.pasteImage");
    if (isImagePaste) {
      if (this.onExtensionShortcut?.(data)) return;
      if (pasteClipboardFilePaths(this, this.imageTokens, this.tui)) return;
      this.onPasteImage?.();
      this.scheduleClipboardPathScan();
      return;
    }
    if (this.imageTokens.deleteImageTokenAtCursor(this, data, this.tui)) return;
    super.handleInput(data);
  }

  insertTextAtCursor(text: string): void {
    super.insertTextAtCursor(this.imageTokens.replaceClipboardPathsInText(text, this.getText()));
  }

  render(width: number): string[] {
    return this.imageTokens.renderChips(super.render(width), this.getTheme(), width);
  }

  private scheduleClipboardPathScan(): void {
    for (const timer of this.scanTimers) clearTimeout(timer);
    this.scanTimers = [80, 250, 600].map((delay) =>
      setTimeout(() => {
        this.imageTokens.replaceClipboardPathsInEditor(this, this.tui);
      }, delay),
    );
  }
}

class BeautifyEditorWrapper implements EditorComponent {
  actionHandlers = new Map<AppKeybinding, () => void>();
  private scanTimers: Array<ReturnType<typeof setTimeout>> = [];
  private _onSubmit: ((text: string) => void) | undefined;
  private _onChange: ((text: string) => void) | undefined;
  onEscape: (() => void) | undefined;
  onCtrlD: (() => void) | undefined;
  onPasteImage: (() => void) | undefined;
  onExtensionShortcut: ((data: string) => boolean) | undefined;

  constructor(
    private readonly inner: EditorComponent,
    private readonly tui: TUI,
    private readonly appKeybindings: KeybindingsManager,
    private readonly imageTokens: ImageTokenController,
    private readonly getTheme: () => Theme,
  ) {}

  get focused(): boolean {
    return Boolean((this.inner as EditorComponent & { focused?: boolean }).focused);
  }

  set focused(value: boolean) {
    (this.inner as EditorComponent & { focused?: boolean }).focused = value;
  }

  get borderColor(): ((str: string) => string) | undefined {
    return this.inner.borderColor;
  }

  set borderColor(value: ((str: string) => string) | undefined) {
    this.inner.borderColor = value;
  }

  get onSubmit(): ((text: string) => void) | undefined {
    return this._onSubmit;
  }

  set onSubmit(handler: ((text: string) => void) | undefined) {
    this._onSubmit = handler;
    this.inner.onSubmit = handler;
  }

  get onChange(): ((text: string) => void) | undefined {
    return this._onChange;
  }

  set onChange(handler: ((text: string) => void) | undefined) {
    this._onChange = handler;
    this.inner.onChange = handler;
  }

  getText(): string {
    return this.inner.getText();
  }

  setText(text: string): void {
    this.inner.setText(text);
  }

  getExpandedText(): string {
    return this.inner.getExpandedText?.() ?? this.inner.getText();
  }

  addToHistory(text: string): void {
    this.inner.addToHistory?.(text);
  }

  insertTextAtCursor(text: string): void {
    const next = this.imageTokens.replaceClipboardPathsInText(text, this.inner.getText());
    if (this.inner.insertTextAtCursor) {
      this.inner.insertTextAtCursor(next);
      return;
    }
    this.inner.setText(this.inner.getText() + next);
    this.inner.onChange?.(this.inner.getText());
  }

  setAutocompleteProvider(provider: AutocompleteProvider): void {
    this.inner.setAutocompleteProvider?.(provider);
  }

  setPaddingX(padding: number): void {
    this.inner.setPaddingX?.(padding);
  }

  setAutocompleteMaxVisible(maxVisible: number): void {
    this.inner.setAutocompleteMaxVisible?.(maxVisible);
  }

  onAction(action: AppKeybinding, handler: () => void): void {
    this.actionHandlers.set(action, handler);
  }

  invalidate(): void {
    this.inner.invalidate?.();
  }

  render(width: number): string[] {
    return this.imageTokens.renderChips(this.inner.render(width), this.getTheme(), width);
  }

  handleInput(data: string): void {
    const isImagePaste = this.appKeybindings.matches(data, "app.clipboard.pasteImage");
    if (this.onExtensionShortcut?.(data)) return;
    if (this.imageTokens.deleteImageTokenAtCursor(this.inner, data, this.tui)) return;
    if (isImagePaste) {
      if (pasteClipboardFilePaths(this, this.imageTokens, this.tui)) return;
      this.onPasteImage?.();
      this.scheduleClipboardPathScan();
      return;
    }
    if (this.handleAppAction(data)) return;
    this.inner.handleInput(data);
  }

  private handleAppAction(data: string): boolean {
    if (this.appKeybindings.matches(data, "app.interrupt")) {
      if (!this.isShowingAutocomplete()) {
        const handler = this.onEscape ?? this.actionHandlers.get("app.interrupt");
        if (handler) {
          handler();
          return true;
        }
      }
      return false;
    }

    if (this.appKeybindings.matches(data, "app.exit")) {
      if (this.getText().length === 0) {
        const handler = this.onCtrlD ?? this.actionHandlers.get("app.exit");
        if (handler) {
          handler();
          return true;
        }
      }
    }

    for (const [action, handler] of this.actionHandlers) {
      if (action !== "app.interrupt" && action !== "app.exit" && this.appKeybindings.matches(data, action)) {
        handler();
        return true;
      }
    }

    return false;
  }

  private isShowingAutocomplete(): boolean {
    const inner = this.inner as EditorComponent & { isShowingAutocomplete?: () => boolean };
    return inner.isShowingAutocomplete?.() ?? false;
  }

  private scheduleClipboardPathScan(): void {
    for (const timer of this.scanTimers) clearTimeout(timer);
    this.scanTimers = [80, 250, 600].map((delay) =>
      setTimeout(() => {
        this.imageTokens.replaceClipboardPathsInEditor(this.inner, this.tui);
      }, delay),
    );
  }
}

function collectImageAttachments(text: string, attachments: Map<string, Attachment>): Attachment[] {
  const selected: Attachment[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(TOKEN_RE)) {
    const token = imageChip(Number(match[1]));
    if (seen.has(token)) continue;
    const attachment = attachments.get(token);
    if (!attachment) continue;
    seen.add(token);
    selected.push(attachment);
  }
  return selected;
}

export default function piAgentBeautify(pi: ExtensionAPI) {
  installMarkdownBeautifyPatch();

  const attachments = new Map<string, Attachment>();

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    // Match tool-execution panel background so code blocks read as panels, not bare text.
    const proto = Markdown.prototype as unknown as PatchedMarkdownPrototype;
    const state = proto[MARKDOWN_PATCH_STATE] as MarkdownPatchState | undefined;
    if (state) {
      state.codeBlockBg = (text: string) => ctx.ui.theme.bg("toolPendingBg", text);
    }
    attachments.clear();
    const previousEditorFactory = ctx.ui.getEditorComponent();
    const imageTokens = new ImageTokenController(attachments);
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      if (!previousEditorFactory) {
        return new BeautifyEditor(tui, theme, keybindings, imageTokens, () => ctx.ui.theme);
      }
      return new BeautifyEditorWrapper(previousEditorFactory(tui, theme, keybindings), tui, keybindings, imageTokens, () => ctx.ui.theme);
    });
    ctx.ui.setStatus("pi-agent-beautify", ctx.ui.theme.fg("dim", "beautify"));
  });

  pi.on("session_shutdown", (_event, ctx) => {
    attachments.clear();
    if (ctx.hasUI) ctx.ui.setStatus("pi-agent-beautify", undefined);
  });

  pi.on("input", async (event) => {
    const selected = collectImageAttachments(event.text, attachments);
    if (selected.length === 0) return { action: "continue" };

    const text = event.text.replace(TOKEN_RE, (full, id) => attachments.get(imageChip(Number(id)))?.path ?? full);
    for (const attachment of selected) attachments.delete(attachment.token);

    return {
      action: "transform",
      text,
      images: event.images,
    };
  });
}
