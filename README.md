# pi-agent-beautify

Terminal visual polish for [pi coding agent](https://pi.dev).  
Forked and extended from [@smoose/pi-beautify](https://github.com/smoosex/pi-beautify).

## Features

### 1. Natural multi-level headings

Upstream pi-tui hides `#` / `##` for H1/H2, but still prints raw `###`… for deeper levels.

This extension:

- hides raw `#` markers for **all** levels (H1–H6)
- adds a clear hierarchy with markers, weight, indent, and rule lines

### 2. Code blocks with tool-panel background

- no raw ` ``` ` fence lines
- no box-drawing characters on code lines (copy stays clean)
- uses the same background as pi tool-execution panels (`toolPendingBg`)
- `text` / `plain` / `plaintext` fences also get the panel background for emphasis

### 3. Clipboard image chips

Clipboard `pi-clipboard-*` paths render as compact `[image1]` chips in the editor, then expand back to real paths before submit.

### 4. User message accent bar

User prompts get a soft blue left stripe (`▎`, theme `borderAccent` / blue) so they read clearly against assistant output — similar to modern chat UIs.

### 5. CJK Markdown emphasis & bold fix

Under the CommonMark specification, bold/italic delimiters (`**`, `*`, `~~`) fail to close when preceded by CJK/ASCII punctuation (like `）` or `)`) and directly followed by CJK characters without whitespace (e.g. `**概念（Concept）**是`).

This extension automatically hooks into Pi's `pi.registerMarkdownTransformer()` to repair these delimiter boundaries display-side:
- Fixes bold, italic, and strikethrough next to CJK punctuation/brackets.
- Fully display-only: never modifies the underlying LLM prompt context or session history.
- Automatically protects code blocks (```...```), inline code (`...`), and LaTeX math expressions.

## Install

### npm (recommended)

```bash
pi install npm:@crushro/pi-agent-beautify
# pin a version
pi install npm:@crushro/pi-agent-beautify@0.2.1
```

### GitHub

```bash
pi install git:github.com/ustc21xyx/pi-agent-beautify
# or
pi install https://github.com/ustc21xyx/pi-agent-beautify
```

### Local path (development)

```bash
pi install /path/to/pi-agent-beautify
pi install ./pi-agent-beautify
```

Try without writing settings:

```bash
pi -e npm:@crushro/pi-agent-beautify
pi -e /path/to/pi-agent-beautify
```

Reload with `/reload` or restart pi after install.

## License

MIT
