import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { CustomEditor, discoverAndLoadExtensions, initTheme } from "@earendil-works/pi-coding-agent";

const { getEditorTheme, getThemeByName } = await import(
  new URL("./modes/interactive/theme/theme.js", import.meta.resolve("@earendil-works/pi-coding-agent"))
);
initTheme("dark", false);
const theme = getThemeByName("dark");
const tui = { terminal: { rows: 24 }, requestRender() {} };
const keybindings = { matches() { return false; } };
const indicator = {
  renderInBorder() { return "Connecting..."; },
  renderSpinnerInBorder() { return "*"; },
};
const directory = await mkdtemp(join(tmpdir(), "pi-beautify-test-"));
after(() => rm(directory, { recursive: true, force: true }));
const extensionPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const result = await discoverAndLoadExtensions([extensionPath], directory, directory);
assert.deepEqual(result.errors, []);
const extension = result.extensions.find((entry) => entry.path === extensionPath);
assert.ok(extension);

async function createEditor(previousFactory) {
  let factory = previousFactory;
  const ctx = {
    hasUI: true,
    ui: {
      theme,
      getEditorComponent() { return factory; },
      setEditorComponent(next) { factory = next; },
      setStatus() {},
    },
  };
  for (const handler of extension.handlers.get("session_start")) {
    await handler({ type: "session_start" }, ctx);
  }
  return { editor: factory(tui, getEditorTheme(), keybindings), factory };
}

function plainEditor() {
  return {
    getText() { return ""; },
    setText() {},
    render() { return ["existing editor"]; },
    handleInput() {},
  };
}

const hasNativeIndicator = typeof CustomEditor.prototype.setWorkingStatusIndicator === "function";

test("default beautify editor opts into embedded working status", async () => {
  const { editor } = await createEditor();
  assert.equal(editor.embedWorkingStatus, true);
  if (hasNativeIndicator) {
    for (const label of ["Connecting...", "Thinking..."]) {
      editor.setWorkingStatusIndicator({ ...indicator, renderInBorder() { return label; } });
      assert.ok(editor.render(80)[0].includes(label), `${label} appears in the top border`);
      editor.setWorkingStatusIndicator(undefined);
      assert.ok(!editor.render(80).join("\n").includes(label), `${label} is cleared`);
    }
  }
});

test("wrapper preserves capability and forwards updates and clearing with the inner receiver", async () => {
  const received = [];
  const inner = {
    ...plainEditor(),
    embedWorkingStatus: true,
    setWorkingStatusIndicator(value) {
      assert.equal(this, inner);
      received.push(value);
    },
  };
  const { editor } = await createEditor(() => inner);
  assert.equal(editor.embedWorkingStatus, true);
  editor.setWorkingStatusIndicator(indicator);
  editor.setWorkingStatusIndicator(undefined);
  assert.deepEqual(received, [indicator, undefined]);
  inner.embedWorkingStatus = false;
  assert.equal(editor.embedWorkingStatus, false);
});

test("wrapper does not opt an unsupported or opted-out editor into embedded status", async () => {
  for (const inner of [
    plainEditor(),
    { ...plainEditor(), embedWorkingStatus: true },
    { ...plainEditor(), setWorkingStatusIndicator() {} },
    { ...plainEditor(), embedWorkingStatus: false, setWorkingStatusIndicator() {} },
  ]) {
    const { editor } = await createEditor(() => inner);
    assert.equal(editor.embedWorkingStatus, false);
    assert.doesNotThrow(() => editor.setWorkingStatusIndicator(indicator));
    assert.deepEqual(editor.render(80), ["existing editor"]);
  }
});

test("wrapping a beautify editor retains native border rendering", { skip: !hasNativeIndicator }, async () => {
  const first = await createEditor();
  const { editor } = await createEditor(first.factory);
  assert.equal(editor.embedWorkingStatus, true);
  editor.setWorkingStatusIndicator(indicator);
  assert.match(editor.render(80).join("\n"), /Connecting\.\.\./);
  editor.setWorkingStatusIndicator(undefined);
  assert.doesNotMatch(editor.render(80).join("\n"), /Connecting\.\.\./);
});
