// What the site's two chats on screen share - the AI Studio's
// (src/shell/chat.mjs) and the AI Pilot's (src/shell/pilot.mjs): the log and
// its rows, the key form and the key held in memory, the speed, Send and
// Stop, and one turn from the message sent to the answer drawn. Each room
// keeps what is its own - the studio its stages, checkpoints and transcript,
// the Pilot its tabs and the bar over the app - and hands it in as hooks.
//
// The two were one file copied twice, down to the comments, with the class
// prefix the only difference (`chat-msg` here, `pilot-msg` there): a fix to
// one - a refused key that put the message back, a Stop pressed while the
// chunk was still downloading - had to be remembered in the other.
//
// The key is the reader's, held in this page's memory for the visit and
// never stored (src/shell/chat.mjs says why); the workspace and the speed
// are stored, under one key each for both chats.
import { listSentFiles, setUpAttaching } from "./attach-ui.mjs";
import { keyTarget, setUpProviderForm } from "./llm-form.mjs";
import { readProviderSettings } from "./llm-provider.mjs";
import { DEFAULT_SPEED, SPEEDS } from "./ai-speeds.mjs";
import { streamMarkdown } from "./markdown.mjs";
import { readStored, removeStored, writeStored } from "./storage.mjs";
import { setStatus } from "./ui.mjs";

// The workspace a key that is not tied to one sends its requests to - the
// API refuses such a key without the anthropic-workspace-id header. Empty
// for the ordinary key, which belongs to a workspace already.
export const WORKSPACE_STORAGE = "abap2ui5-playground:anthropic-workspace";
// Thorough, Balanced or Fast (SPEEDS in ai-speeds.mjs). Kept only while it
// differs from Balanced, the rule the page's other preferences follow.
const SPEED_STORAGE = "abap2ui5-playground:ai-speed";
// The one width the stylesheet and layout.mjs share for "a phone".
export const narrow = () => window.matchMedia("(max-width: 820px)").matches;

/*
 * One chat on screen. `prefix` is the room's class and id prefix ("chat",
 * "pilot"); `el` its elements (log, compose, input, send, keyForm, keyInput,
 * workspaceInput, keyButton, keyRemove, usage, reset, speed, chat, stage,
 * attach, fileInput, files). The hooks:
 *
 *   onBusy(busy)                the room's own mark of a turn under way
 *   onStartOver()               what else goes when the conversation does
 *   onBusy(busy)                a turn under way, or over
 *   showWelcome()               the empty log, after New chat
 *   rules()                     the agent chunk, for the files' kinds and limit
 *
 * and for a turn, `turn`:
 *
 *   load()                      the agent chunk
 *   createAgent({ mod, apiKey, workspace, provider, ui })   the conversation
 *   sent({ line, typed, files })   the reader's message is in the log; what
 *                               it answers is handed to answered( )
 *   working, done               the status line while and after
 *   ui                          the room's half of the agent's ui calls:
 *                               text(raw, line), tool(info), notice(text), acting(text)
 *   answered(context)           a turn that ended, whatever way - the files
 *                               may have changed before it failed
 *   failed({ stopped })         a turn that ended in an error: the message is
 *                               no longer in the conversation unless `stopped`
 *   settled()                   a turn that ended, whatever way
 */
export function createChatRoom({ prefix, el, onBusy, onStartOver, showWelcome, rules, turn: room }) {
  let sessionKey = null;
  // The provider half of the key form (llm-form.mjs): Anthropic, or an
  // OpenAI-compatible server with its base URL and model.
  let providerForm;
  // Which server the key in memory was typed for (keyTarget in llm-form.mjs).
  let keyFor;
  let agent;
  // The agent whose turn is running, which is not always `agent`: a new key or
  // New chat replaces `agent` while a turn may still be under way, and Stop has
  // to reach the turn that is actually running.
  let active;
  // Stop pressed while the chat's chunk was still downloading, before there
  // was an agent to tell.
  let stopAsked = false;
  // Bumped by everything that starts the conversation over. A turn still
  // running from before draws nothing into the new log.
  let generation = 0;
  // What the running turn is drawing: the answer being written, its raw
  // markdown and the renderer it streams into, the progress note, and each
  // tool call's row by its id.
  let current;
  let raw = "";
  let draw;
  let note;
  const rows = new Map();
  let busy = false;

  function addLine(kind, text) {
    const div = document.createElement("div");
    div.className = `${prefix}-msg ${prefix}-${kind}`;
    div.textContent = text;
    el.log.append(div);
    scrollDown();
    return div;
  }

  // The log follows the answer while the reader is at its end. Scrolled up to
  // read something earlier, they stay there: every delta of a turn that runs
  // for minutes pulled them back down, several times a second. A scroll the
  // page makes itself lands at the end and keeps `following` true.
  let following = true;
  function scrollDown(force = false) {
    if (force) following = true;
    if (following) el.log.scrollTop = el.log.scrollHeight;
  }

  function flashStage() {
    el.stage.classList.remove("is-flash");
    void el.stage.offsetWidth;
    el.stage.classList.add("is-flash");
  }

  // Every tool row still drawn as pending is a call that will not finish now -
  // stopped, refused, or the request failed under it. Left as it was, it went
  // on shimmering as if the work were still going on.
  function finishRows() {
    for (const row of rows.values()) {
      row.className = `${prefix}-msg ${prefix}-tool is-error`;
      row.textContent = `${row.textContent.replace(/…$/, "")} - not finished`;
    }
    rows.clear();
  }

  function stopTurn() {
    stopAsked = true;
    active?.stop();
  }

  // The conversation is over: the turn still running (if any) is stopped, and
  // whatever it still says goes nowhere - see `generation`.
  function startOver() {
    if (busy) stopTurn();
    agent = undefined;
    generation += 1;
    finishRows();
    // The old turn may still be inside a tool (a run, an app opening) and
    // only unwinds when that ends; the new conversation is not busy.
    setBusy(false);
    // Its tokens went with it.
    el.usage.textContent = "";
    el.usage.title = "";
    onStartOver?.();
  }

  // No key? A model on the reader's own machine needs none: the key form,
  // turned to an OpenAI-compatible server at Ollama's address unless a base
  // URL is already set. The model's name is the reader's to type - nothing
  // here knows what they pulled. Both welcomes offer it while no key is held.
  function offerLocalModel() {
    showKeyForm(true);
    const provider = document.getElementById(`${prefix}-provider`);
    const baseUrl = document.getElementById(`${prefix}-base-url`);
    const model = document.getElementById(`${prefix}-model`);
    provider.value = "openai";
    provider.dispatchEvent(new Event("change"));
    if (baseUrl.value.trim() === "" || baseUrl.value.trim() === "https://api.openai.com/v1") {
      baseUrl.value = "http://localhost:11434/v1";
      baseUrl.dispatchEvent(new Event("input"));
    }
    model.focus();
  }

  /** The welcome's way in without a key, as a paragraph (`${prefix}-local`),
   *  or null while a key is held. The rooms remove it once a key is. */
  function localModelOffer() {
    if (sessionKey !== null) return null;
    const local = document.createElement("p");
    local.className = `${prefix}-local`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ghost ${prefix}-local-open`;
    button.textContent = "Use a model on your own machine";
    button.addEventListener("click", offerLocalModel);
    local.append("No API key? ", button, " - Ollama or LM Studio, no key and no cost; it needs a model that can call tools.");
    return local;
  }

  function showKeyForm(show) {
    el.keyForm.hidden = !show;
    el.keyRemove.hidden = sessionKey === null;
    if (show) {
      el.workspaceInput.value = readStored(WORKSPACE_STORAGE) ?? "";
      providerForm.fill();
    }
  }

  // The header follows the provider: the speeds are Anthropic's models, so an
  // OpenAI-compatible server - one model, named in the form - has no select.
  function reflectProvider(settings) {
    el.speed.hidden = settings.provider !== "anthropic";
    el.keyButton.title = settings.provider === "openai"
      ? `${settings.model} at ${settings.baseUrl} - your API key, and which model API answers`
      : "Your API key, and which model API answers";
  }

  function setBusy(value) {
    busy = value;
    el.send.textContent = busy ? "Stop" : "Send";
    el.send.classList.toggle("primary", !busy);
    el.chat.classList.toggle("is-busy", busy);
    onBusy?.(busy);
    // The answer's last block is redrawn on every delta, inside a live
    // region: busy, a screen reader waits for the turn rather than reading
    // it again on each redraw.
    el.log.setAttribute("aria-busy", String(busy));
  }

  // ------------------------------------------------------------- the wiring

  providerForm = setUpProviderForm(prefix);
  reflectProvider(readProviderSettings());
  el.keyForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const key = el.keyInput.value.trim();
    // A key goes only to the server it was typed for: another provider or
    // base URL asks for its own (an Anthropic key sent as the bearer of
    // somebody's OpenAI-compatible server is a key given away). The
    // workspace can be added later on its own, to a key already held - and
    // a local server needs no key at all.
    const target = keyTarget(providerForm.read());
    if (key === "" && keyFor !== target && providerForm.keyRequired()) {
      sessionKey = null;
      keyFor = undefined;
      el.keyRemove.hidden = true;
      el.keyInput.focus();
      return;
    }
    // Whether anything the conversation's client was made of changes: the
    // key, the server it goes to, the model named for it, the workspace.
    // Save pressed on a form left as it was used to start the conversation
    // over all the same - opened to look, closed with Save, chat gone.
    const was = { key: sessionKey, target: keyFor, workspace: readStored(WORKSPACE_STORAGE) ?? "", settings: JSON.stringify(readProviderSettings()) };
    if (key !== "" || keyFor !== target) {
      sessionKey = key;
      keyFor = target;
    }
    const workspace = el.workspaceInput.value.trim();
    if (workspace === "") removeStored(WORKSPACE_STORAGE);
    else writeStored(WORKSPACE_STORAGE, workspace);
    const settings = providerForm.save();
    reflectProvider(settings);
    el.keyInput.value = "";
    const changed = sessionKey !== was.key || keyFor !== was.target || workspace !== was.workspace || JSON.stringify(settings) !== was.settings;
    // A new key is a new client; the conversation so far went with the old one,
    // and so does a turn still running on the old key.
    if (changed) startOver();
    showKeyForm(false);
    el.input.focus();
  });
  el.keyRemove.addEventListener("click", () => {
    sessionKey = null;
    keyFor = undefined;
    removeStored(WORKSPACE_STORAGE);
    el.workspaceInput.value = "";
    startOver();
    showKeyForm(true);
  });
  el.keyButton.addEventListener("click", () => showKeyForm(el.keyForm.hidden));

  el.compose.addEventListener("submit", (e) => {
    e.preventDefault();
    if (busy) stopTurn();
    else submit();
  });
  el.log.addEventListener("scroll", () => {
    following = el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < 48;
  }, { passive: true });
  // Enter sends, Shift+Enter is a new line - what every chat does.
  el.input.addEventListener("keydown", (e) => {
    // Safari ends the composition BEFORE the Enter that commits it, so
    // isComposing is already false there; keyCode 229 is that Enter.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      if (!busy) submit();
    }
  });

  // Files for the next message: the paperclip and a paste here, a drop where
  // the room listens for one (attach-ui.mjs). The kinds and the limit are the
  // agent chunk's.
  const attaching = setUpAttaching({
    prefix,
    button: el.attach,
    input: el.fileInput,
    list: el.files,
    textarea: el.input,
    rules,
    refused: (text) => addLine("notice is-error", text),
  });

  el.reset.addEventListener("click", () => {
    startOver();
    showWelcome();
  });

  // The speeds, from the one list (ai-speeds.mjs); asked before every
  // request, so a change applies from the next turn on.
  for (const [value, { label }] of Object.entries(SPEEDS)) el.speed.append(new Option(label, value, value === DEFAULT_SPEED, value === DEFAULT_SPEED));
  const stored = readStored(SPEED_STORAGE);
  if (stored && [...el.speed.options].some((o) => o.value === stored)) el.speed.value = stored;
  el.speed.addEventListener("change", () => {
    if (el.speed.value === DEFAULT_SPEED) removeStored(SPEED_STORAGE);
    else writeStored(SPEED_STORAGE, el.speed.value);
  });

  // ---------------------------------------------------------------- a turn

  // What the agent draws (the `ui` of createAgent and createPilot): the rows
  // both chats draw alike, then the room's own half.
  function uiFor(mod) {
    const own = room.ui ?? {};
    return {
      assistantStart() {
        current = undefined;
        note = undefined;
      },
      thinkingStart() {
        note = undefined;
      },
      thinking(delta) {
        current = undefined;
        if (!note) note = addLine("progress", "");
        note.textContent += delta;
        scrollDown();
      },
      toolPending({ id, text }) {
        current = undefined;
        note = undefined;
        let row = rows.get(id);
        if (!row) {
          row = addLine("tool is-pending", "");
          rows.set(id, row);
        }
        row.textContent = text;
        scrollDown();
      },
      text(delta) {
        if (!current) {
          current = addLine("assistant", "");
          raw = "";
          draw = streamMarkdown(current);
        }
        // Drawn on every delta, a half-written **bold** becoming bold once it
        // closes - and only the block still being written is drawn again
        // (streamMarkdown in markdown.mjs), so a long answer is not rebuilt
        // from the top a few thousand times.
        raw += delta;
        draw(delta);
        scrollDown();
        own.text?.(raw, current);
      },
      tool(info) {
        current = undefined;
        note = undefined;
        const row = rows.get(info.id) ?? addLine("tool", "");
        rows.delete(info.id);
        row.className = `${prefix}-msg ${prefix}-tool${info.error ? " is-error" : ""}`;
        row.textContent = info.summary;
        scrollDown();
        own.tool?.(info);
      },
      usage(total) {
        const { text, title } = mod.usageText(total);
        el.usage.textContent = text;
        el.usage.title = title;
      },
      notice(t) {
        current = undefined;
        addLine("notice", t);
        own.notice?.(t);
      },
      acting(t) {
        own.acting?.(t);
      },
    };
  }

  async function submit() {
    const typed = el.input.value.trim();
    // A file dropped a moment ago may still be being checked in.
    await attaching.settled();
    if (busy || (typed === "" && attaching.count === 0)) return;
    // Files alone are a message too: the model is told they are what it is about.
    const text = typed || "Here are the files.";
    if (sessionKey === null) {
      showKeyForm(true);
      el.keyInput.focus();
      return;
    }
    el.log.querySelector(`.${prefix}-welcome`)?.remove();
    el.input.value = "";
    const files = attaching.take();
    const line = addLine("user", typed);
    listSentFiles(line, files, `${prefix}-user-files`);
    const context = room.sent?.({ line, typed, files });
    scrollDown(true);
    setBusy(true);
    stopAsked = false;
    current = undefined;
    note = undefined;
    raw = "";

    // This turn's conversation; anything it says after the conversation was
    // started over is dropped.
    const gen = generation;
    const live = () => gen === generation;
    let mod;
    let turn;
    try {
      mod = await room.load();
      if (stopAsked || !live()) {
        if (live()) addLine("notice", "Stopped.");
        setStatus("stopped");
        return;
      }
      if (!agent) {
        // Every callback asks whether its conversation is still the one on
        // screen - `ui` belongs to this agent for as long as it lives.
        const agentGen = generation;
        const guarded = Object.fromEntries(
          Object.entries(uiFor(mod)).map(([k, f]) => [k, (...args) => (agentGen === generation ? f(...args) : undefined)]),
        );
        agent = room.createAgent({
          mod,
          apiKey: sessionKey,
          workspace: readStored(WORKSPACE_STORAGE) ?? undefined,
          provider: readProviderSettings(),
          ui: guarded,
        });
      }
      turn = agent;
      active = turn;
      setStatus(room.working);
      const { stopped } = await turn.send(text, files);
      if (!live()) return;
      if (stopped) addLine("notice", "Stopped.");
      setStatus(stopped ? "stopped" : room.done);
    } catch (e) {
      if (!live()) return;
      const said = mod ? mod.explainError(e) : { text: `The AI part of the page could not be loaded: ${String(e?.message ?? e)}` };
      addLine(said.stopped ? "notice" : "notice is-error", said.text);
      setStatus(said.stopped ? "stopped" : "the AI request failed", !said.stopped);
      room.failed?.({ stopped: Boolean(said.stopped) });
      if (said.key) {
        // The message never reached a model, and a new key is a new
        // conversation: what was typed and attached is put back to send again.
        if (el.input.value === "") el.input.value = typed;
        if (files.length > 0) attaching.add(files);
        showKeyForm(true);
        // A key without a workspace is a valid key - what is missing is the
        // workspace, so that is where the caret goes.
        (said.workspace ? el.workspaceInput : el.keyInput).focus();
      }
    } finally {
      if (active === turn) active = undefined;
      // A turn of a conversation started over leaves the new one alone - it
      // was set idle by startOver( ) and may be busy with a turn of its own.
      if (live()) {
        finishRows();
        setBusy(false);
        // Whatever way the turn ended: a turn whose tools changed three
        // files and whose next request the API refused still changed them,
        // and offered nothing to put them back.
        room.answered?.(context);
        room.settled?.();
      }
    }
  }

  return {
    addLine,
    scrollDown,
    flashStage,
    showKeyForm,
    localModelOffer,
    startOver,
    // The tool rows still pending, by id - the studio's ✎ takes the
    // exchange out of the log, rows and all.
    rows,
    get attaching() {
      return attaching;
    },
    get busy() {
      return busy;
    },
    get agent() {
      return agent;
    },
    hasKey: () => sessionKey !== null,
  };
}
