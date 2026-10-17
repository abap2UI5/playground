// The abaplint and abap2UI5 lint tabs: the two checkers' settings, as text
// you can edit. JSON rather than a wall of switches: abaplint has 188 rules
// and the playground runs nine of them, so a checkbox per rule would be a
// screen nobody reads to reach a setting nobody wanted. What a reader
// actually asks is "why is it not warning here" - and the answer is to add
// the rule name and press Apply.
//
// The checkers hold and validate a configuration; what is remembered between
// visits is checker-settings.mjs's business (onKeep below).
import { invalidateAnalysis, refreshNow } from "../editor/editor.mjs";
import {
  abaplintDefaults,
  abaplintSettings,
  allRuleNames,
  applyAbaplintSettings,
} from "../editor/registry.mjs";
import { applyLinterSettings, linterDefaults, linterSettings, onLinterSettings } from "../editor/abap2ui5-lint.mjs";
import { keepAbaplintSettings, keepLinterSettings } from "./checker-settings.mjs";
import { problemsChanged } from "./insight-common.mjs";

function configEditor({ title, blurb, value, onApply, onKeep, onReset, extra, follow }) {
  const wrap = document.createElement("div");
  wrap.className = "config";

  const head = document.createElement("p");
  head.className = "config-blurb";
  head.append(blurb);
  wrap.append(head);

  const area = document.createElement("textarea");
  area.className = "config-text";
  area.spellcheck = false;
  area.setAttribute("aria-label", `${title} settings, as JSON`);
  area.value = JSON.stringify(value, null, 2);
  wrap.append(area);

  const row = document.createElement("div");
  row.className = "config-row";

  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "primary";
  apply.textContent = "Apply";

  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Reset";

  const said = document.createElement("span");
  said.className = "config-said";
  // "applying… / applied / no rule called" were never announced.
  said.setAttribute("role", "status");

  row.append(apply, reset, said);
  wrap.append(row);

  if (extra) wrap.append(extra);

  // A change applied somewhere else (the bar's UI5 select): the text follows
  // it - unless it holds an edit not applied yet, which is the reader's.
  // The tab is built afresh each time it is opened, so a copy no longer on
  // screen stops listening the first time it is told.
  const stop = follow?.((now, before) => {
    if (!area.isConnected) {
      stop?.();
      return;
    }
    let typed;
    try {
      typed = JSON.parse(area.value);
    } catch {
      return;
    }
    if (JSON.stringify(typed) === JSON.stringify(before)) area.value = JSON.stringify(now, null, 2);
  });

  apply.addEventListener("click", async () => {
    // Changing abaplint's rules dirties every object in the corpus, so applying
    // them is the startup parse over again - seconds, during which the button
    // must not be pressable a second time and the panel should say what is
    // going on rather than appear to have ignored the click.
    if (apply.disabled) return;
    apply.disabled = true;
    reset.disabled = true;
    said.className = "config-said";
    said.textContent = "applying…";
    try {
      const parsed = JSON.parse(area.value);
      // Whether this is asynchronous is the checker's business, not this
      // function's: abaplint's half yields while it reparses, the linter's is
      // a field assignment. Awaiting covers both.
      await onApply(parsed, (done, total) => {
        said.textContent = `applying… ${Math.round((done / total) * 100)}%`;
      });
      // Kept only once the checker accepted it, so a rejected edit is not
      // what greets somebody on their next visit.
      onKeep(parsed);
      // The text did not change, the rules did - and the editor keys its kept
      // analysis on the text alone. Without this the count below would be the
      // one from before the change, which is precisely the number this tab
      // exists to move.
      invalidateAnalysis();
      // The panel says what changed rather than only that something did: the
      // whole point of the tab is understanding why a message is or is not
      // there, so the count is the answer.
      // Waited for: right after invalidateAnalysis( ) the kept answer is
      // empty, and refresh( ) handed that back - "applied - 0 problems now"
      // whatever the rules said, with the panel flashing empty under it.
      const problems = await refreshNow();
      problemsChanged(problems);
      said.textContent = `applied - ${problems.length} problem${problems.length === 1 ? "" : "s"} now`;
    } catch (e) {
      said.className = "config-said is-error";
      said.textContent = String(e.message || e);
    } finally {
      apply.disabled = false;
      reset.disabled = false;
    }
  });

  reset.addEventListener("click", () => {
    area.value = JSON.stringify(onReset(), null, 2);
    apply.click();
  });

  return wrap;
}

// Where the rules come from, for a reader who wants the whole list rather than
// the nine the playground runs.
function docsLink(href, text) {
  const p = document.createElement("p");
  p.className = "config-link";
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = text;
  p.append(a);
  return p;
}

export function abaplintTab() {
  const note = document.createElement("details");
  note.className = "config-more";
  const summary = document.createElement("summary");
  summary.textContent = "Every rule abaplint has";
  note.append(summary);
  const list = document.createElement("p");
  list.className = "config-rules";
  list.textContent = allRuleNames().join(", ");
  note.append(list);

  const links = document.createElement("div");
  links.append(
    docsLink("https://rules.abaplint.org", "Every rule, with what it does and why — rules.abaplint.org"),
    docsLink("https://github.com/abaplint/abaplint", "abaplint on GitHub"),
  );

  return configEditor({
    title: "abaplint",
    blurb:
      "What the editor checks. The playground runs the rules that answer " +
      "“would this work”, not the ones that answer “is this the house style” - " +
      "but any of abaplint's rules can be added here. version is the ABAP release the " +
      "syntax check holds you to.",
    value: abaplintSettings(),
    onApply: applyAbaplintSettings,
    onKeep: keepAbaplintSettings,
    onReset: abaplintDefaults,
    extra: appended(links, note),
  });
}

export function linterTab() {
  return configEditor({
    title: "abap2UI5 linter",
    blurb:
      "What the abap2UI5 linter checks the view against. ui5 is the oldest release " +
      "your app has to work on - lowering it finds controls and properties that a " +
      "newer system would render and an older one would not.",
    value: linterSettings(),
    onApply: applyLinterSettings,
    onKeep: keepLinterSettings,
    onReset: linterDefaults,
    follow: onLinterSettings,
    extra: appended(
      docsLink("https://github.com/abap2UI5/linter", "The abap2UI5 linter, its rules and its config file"),
      docsLink("https://www.npmjs.com/package/@abap2ui5/linter", "@abap2ui5/linter on npm"),
    ),
  });
}

// Several bits of trailing matter as one node, because configEditor takes one.
function appended(...nodes) {
  const box = document.createElement("div");
  box.append(...nodes);
  return box;
}
