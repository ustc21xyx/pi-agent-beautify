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

## Install

### npm (recommended)

```bash
pi install npm:pi-agent-beautify
# pin a version
pi install npm:pi-agent-beautify@0.1.1
```

### GitHub

```bash
pi install git:github.com/baipiaoking88/pi-agent-beautify
# or
pi install https://github.com/baipiaoking88/pi-agent-beautify
```

### Local path (development)

```bash
pi install /path/to/pi-agent-beautify
pi install ./pi-agent-beautify
```

Try without writing settings:

```bash
pi -e npm:pi-agent-beautify
pi -e /path/to/pi-agent-beautify
```

Reload with `/reload` or restart pi after install.

## License

MIT
