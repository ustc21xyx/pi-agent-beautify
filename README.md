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
pi install npm:pi-agent-beautify@0.1.0
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

## Publish (maintainers)

### npm

```bash
npm login
cd /path/to/pi-agent-beautify
npm pack --dry-run
npm publish
```

### GitHub backup

```bash
# create empty repo on GitHub named pi-agent-beautify, then:
git remote add origin git@github.com:baipiaoking88/pi-agent-beautify.git
git push -u origin main
git tag v0.1.0
git push origin v0.1.0
```

After publishing, other machines can use:

```bash
pi install npm:pi-agent-beautify
# or
pi install git:github.com/baipiaoking88/pi-agent-beautify
```

## Compared with upstream

| Feature | pi-tui default | @smoose/pi-beautify | pi-agent-beautify |
|---------|----------------|---------------------|----------------------|
| Hide code fences | no | yes | yes |
| Tool-panel code background | no | no | yes |
| Image chips | no | yes | yes |
| H1/H2 without raw `#` | yes | yes | yes |
| H3–H6 without raw `###`… | no | no | yes |
| Heading hierarchy styling | weak | weak | yes |

## Implementation notes

Monkey-patches `Markdown.prototype.renderToken`:

- `heading` → natural styled headings, no raw `#` markers
- `code` → tool-panel background, no fence/box glyphs

Patch state is stored on the prototype via `Symbol.for("pi-agent-beautify.markdown.patch")` so reloads stay safe.

## License

MIT
