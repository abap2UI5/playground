// Monaco's language providers for ABAP, answered by the registry worker.
//
// @abaplint/monaco does the same job with a registry in hand: each provider
// makes a LanguageServer call and maps the LSP answer into Monaco's shape.
// The registry is in a worker now, so the call is a message and the answer a
// promise - which every provider here is allowed to return - and the mapping
// is the same as theirs (MIT, and the shapes are LSP's, not anybody's). The
// snippet provider needs no registry at all and is taken from the package.
import * as monaco from "monaco-editor/editor/editor.api.js";
import { ABAPSnippetProvider } from "@abaplint/monaco/build/abap_snippet_provider.js";
import { languageServer as askServer, semanticTokensLegend } from "./registry.mjs";

const uriOf = (model) => model.uri.toString();
const positionOf = (position) => ({ line: position.lineNumber - 1, character: position.column - 1 });
const at = (model, position) => ({ textDocument: { uri: uriOf(model) }, position: positionOf(position) });
const rangeOf = (r) => new monaco.Range(r.start.line + 1, r.start.character + 1, r.end.line + 1, r.end.character + 1);
const locations = (found) => (found ?? []).map((f) => ({ uri: monaco.Uri.parse(f.uri), range: rangeOf(f.range) }));

// `host.files()` is what the editor currently holds - see connectRegistry( )
// in src/editor/editor.mjs. Only the formatter needs it, and it needs it
// because a file is formatted in the company of the others: an include is not
// an object on its own, and abaplint has nothing to print for one.
export function registerProviders(host) {
  // Every question goes with the files as the editor has them NOW. The
  // worker's copy is brought up to date by the analysis, 150ms after the
  // typing stops plus a round trip - and Monaco asks for semantic tokens
  // 100ms after an edit, so the last request was answered for the previous
  // text and the colours stayed shifted; a hover, a rename or a code action
  // straight after typing hit positions in text that was no longer there.
  //
  // But not every file with its TEXT. A file whose version (`host.version`,
  // Monaco's model id and version id) is the one this last sent the text
  // under goes as `{ name, version }` alone - a document highlight is asked
  // on every cursor move, and every one of them used to carry every open
  // file across the thread. The worker is the judge: `sent` is what THIS
  // side sent, and a worker that does not hold a file at that version (a
  // fresh worker, a text changed under it by a fix) answers `needsText`
  // with the names, and the question is asked again with them in full - so
  // the answer is always for the text on screen, and a lost version costs
  // one round trip rather than a wrong answer.
  const sent = new Map();
  const payload = (inFull) =>
    host.files().map(({ name, source }) => {
      const version = host.version(name);
      return !inFull.has(name) && sent.get(name) === version ? { name, version } : { name, source, version };
    });
  const languageServer = async (method, params) => {
    let files = payload(new Set());
    let answer = await askServer(method, params, files);
    if (answer?.needsText) {
      files = payload(new Set(answer.needsText));
      answer = await askServer(method, params, files);
    }
    // Only now, with the worker's answer: a question it did not take did
    // not teach it the text.
    for (const name of [...sent.keys()]) if (!files.some((f) => f.name === name)) sent.delete(name);
    for (const { name, version } of files) sent.set(name, version);
    return answer;
  };
  monaco.languages.registerCompletionItemProvider("abap", new ABAPSnippetProvider());

  monaco.languages.registerHoverProvider("abap", {
    async provideHover(model, position) {
      const hover = await languageServer("hover", at(model, position));
      if (!hover) return undefined;
      return {
        range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
        contents: [{ value: hover.contents.value }],
      };
    },
  });

  // Shift+Alt+F, Monaco's own binding. It runs the SAME formatter the bar's
  // Format button runs - abaplint's layout fixes and then its pretty printer,
  // in the worker (formatFiles( ) in src/editor/registry-core.mjs) - and not,
  // as it used to, the pretty printer alone through `documentFormatting`.
  // Two ways in with two ideas of what formatting means is a bug somebody
  // finds by pressing the other one.
  //
  // What comes back is the whole file set, formatted. Monaco can be handed an
  // edit for the model it asked about and no other, so that one goes back as
  // the edit - and the OTHER files are written through the host, the same
  // door the button's format( ) uses, so the key and the button leave the
  // same files behind. They used to differ: the key formatted the open file
  // and dropped the rest, while README, AGENTS.md and the About dialog each
  // described a different one of the two.
  //
  // And now it IS the button's format( ), every file written by it and
  // nothing handed back to Monaco. The current file used to go back as the
  // edit, which Monaco first passed through its editor worker - stubbed
  // here, so that call only ended at its one-second timeout - and then
  // dropped if the cursor had moved meanwhile, while the status line already
  // said every file was formatted. The other files were written with no
  // check that they were still as they had been sent.
  monaco.languages.registerDocumentFormattingEditProvider("abap", {
    async provideDocumentFormattingEdits() {
      const result = host?.format ? await host.format() : { formatted: 0 };
      // The status line is the bar's to write (src/shell/main.mjs listens),
      // and it says the same thing for both ways in.
      document.dispatchEvent(new CustomEvent("abap2ui5-formatted", { detail: { formatted: result.formatted } }));
      return [];
    },
  });

  monaco.languages.registerDocumentSymbolProvider("abap", {
    async provideDocumentSymbols(model) {
      const symbols = await languageServer("documentSymbol", { textDocument: { uri: uriOf(model) } });
      return (symbols ?? []).map((symbol) => ({
        range: rangeOf(symbol.range),
        name: symbol.name,
        kind: symbol.kind,
        detail: symbol.detail ?? "",
        tags: [],
        selectionRange: rangeOf(symbol.selectionRange),
      }));
    },
  });

  monaco.languages.registerDefinitionProvider("abap", {
    async provideDefinition(model, position) {
      const def = await languageServer("gotoDefinition", at(model, position));
      return def ? { uri: monaco.Uri.parse(def.uri), range: rangeOf(def.range) } : undefined;
    },
  });

  monaco.languages.registerRenameProvider("abap", {
    async provideRenameEdits(model, position, newName) {
      const rename = await languageServer("rename", { ...at(model, position), newName });
      // A global class or interface renamed is a file renamed as well (the
      // answer carries rename operations and an XML edit): applied as text
      // edits only, the file would declare one name under another, and on
      // the first file Run would break. Refused, rather than half done.
      if ((rename?.documentChanges ?? []).some((c) => c.kind)) {
        return { edits: [], rejectReason: "A global class or interface is renamed by renaming its file." };
      }
      const edits = [];
      for (const change of rename?.documentChanges ?? []) {
        // A TextDocumentEdit carries `edits`; the other kinds (create, rename,
        // delete a file) are nothing an in-page rename produces.
        // To the document the change names, not the one the cursor is in:
        // abaplint answers with one TextDocumentEdit per file that refers to
        // the name (a method renamed from its class has the test include's
        // ranges in the same answer), and every file here has a model.
        const uri = change.textDocument?.uri;
        const resource = uri ? monaco.Uri.parse(uri) : model.uri;
        if (!monaco.editor.getModel(resource)) continue;
        for (const e of change.edits ?? []) {
          edits.push({ resource, versionId: undefined, textEdit: { range: rangeOf(e.range), text: e.newText ?? newName } });
        }
      }
      return { edits };
    },
    async resolveRenameLocation(model, position) {
      // Defined in the framework, not in a file of the page: abaplint labels
      // the definition's edit with the reader's own file, so the rename put a
      // method name into the wrong file at a line from another one.
      const def = await languageServer("gotoDefinition", at(model, position));
      if (def && !monaco.editor.getModel(monaco.Uri.parse(def.uri))) {
        throw new Error("Defined in abap2UI5, not in these files - it cannot be renamed here");
      }
      const rename = await languageServer("prepareRename", at(model, position));
      if (rename) return { range: rangeOf(rename.range), text: rename.placeholder };
      throw new Error("Cannot be renamed");
    },
  });

  monaco.languages.registerDocumentHighlightProvider("abap", {
    async provideDocumentHighlights(model, position) {
      const found = await languageServer("documentHighlight", at(model, position));
      return (found ?? []).map((f) => ({ range: rangeOf(f.range) }));
    },
  });

  monaco.languages.registerCodeActionProvider("abap", {
    async provideCodeActions(model, range) {
      const found = await languageServer("codeActions", {
        textDocument: { uri: uriOf(model) },
        range: {
          start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
          end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
        },
        context: { diagnostics: [] },
      });
      const actions = [];
      for (const f of found ?? []) {
        if (f.edit === undefined) continue;
        const edits = [];
        for (const [filename, changes] of Object.entries(f.edit.changes ?? {})) {
          for (const c of changes) {
            edits.push({ resource: monaco.Uri.parse(filename), versionId: undefined, textEdit: { range: rangeOf(c.range), text: c.newText } });
          }
        }
        actions.push({ title: f.title, kind: f.kind, diagnostics: [], edit: { edits } });
      }
      return { actions, dispose() {} };
    },
  });

  monaco.languages.registerImplementationProvider("abap", {
    async provideImplementation(model, position) {
      return locations(await languageServer("implementation", at(model, position)));
    },
  });

  monaco.languages.registerReferenceProvider("abap", {
    async provideReferences(model, position) {
      return locations(await languageServer("references", at(model, position)));
    },
  });

  monaco.languages.registerDocumentRangeSemanticTokensProvider("abap", {
    getLegend: () => semanticTokensLegend(),
    async provideDocumentRangeSemanticTokens(model, range) {
      const result = await languageServer("semanticTokensRange", {
        textDocument: { uri: uriOf(model) },
        // Zero-based, like every other range handed over: abaplint adds one
        // to build its own positions, and passed Monaco's one-based numbers
        // as they were the window began a line late, so a statement ending
        // on the first visible line lost its colour.
        start: positionOf({ lineNumber: range.startLineNumber, column: range.startColumn }),
        end: positionOf({ lineNumber: range.endLineNumber, column: range.endColumn }),
      });
      return { data: Uint32Array.from(result?.data ?? []) };
    },
  });
}
