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
import { formatFiles, languageServer, semanticTokensLegend } from "./registry.mjs";

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
  // What comes back is the whole file set, formatted; Monaco can be handed an
  // edit for the model it asked about and no other, so the rest is dropped
  // here and the button is the way to format them all.
  monaco.languages.registerDocumentFormattingEditProvider("abap", {
    async provideDocumentFormattingEdits(model) {
      const name = model.uri.path.replace(/^\//, "");
      const result = await formatFiles(host?.files?.() ?? []);
      const formatted = result.files.find((f) => f.name === name);
      if (!formatted) return undefined;
      return [{ range: model.getFullModelRange(), text: formatted.source }];
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
      const edits = [];
      for (const change of rename?.documentChanges ?? []) {
        // A TextDocumentEdit carries `edits`; the other kinds (create, rename,
        // delete a file) are nothing an in-page rename produces.
        for (const e of change.edits ?? []) {
          edits.push({ resource: model.uri, versionId: undefined, textEdit: { range: rangeOf(e.range), text: newName } });
        }
      }
      return { edits };
    },
    async resolveRenameLocation(model, position) {
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
        start: { line: range.startLineNumber, character: range.startColumn },
        end: { line: range.endLineNumber, character: range.endColumn },
      });
      return { data: Uint32Array.from(result?.data ?? []) };
    },
  });
}
