# The AI chat (AI Studio)

> Design notes, moved out of `AGENTS.md`. Read this before touching `chat.mjs`, `chat-ui.mjs`, `ai-agent.mjs`, `ai-common.mjs`, `llm-*.mjs`, `markdown.mjs` or `attach-ui.mjs`.
> The rules in short, and every other area, are in [AGENTS.md](../../AGENTS.md).

## The AI chat — `src/shell/chat.mjs`, `src/shell/ai-agent.mjs`

**The studio has a page of its own and no door from the playground** while it
is being built: `ai/index.html`, written by `writeAiPage( )` in
`tools/site-documents.mjs` from the playground's finished `index.html` - the same
document one directory down, with `<base href="../">` (so the bundle, the
workers the inline script starts, the app frame and the service worker's scope
all resolve where the playground's do: one build, two doors), `data-page="ai"`
on `<html>`, its own title, no canonical link and `noindex`. `page.mjs` reads
`data-page` (`aiPage`) and `main.mjs` acts on it: only there is `setUpChat( )` called (with `startOpen`), the editor
starts on one minimal class (`AI_STARTER` in `ai-starter.mjs`: `z2ui5_if_app`
implemented, `main( )` empty) without a run - the placeholder says
where the app will appear and `run( )` takes it away when an app first starts
- and no draft is restored or stored, so the studio never writes over the
playground's own work. Nor is Auto restored: its switch is in the toolbar the
studio hides, and a restored Auto ran the model's half-finished turn on every
pause. The model's first `write_file` of another class drops
the starter while it is untouched (`isUntouchedStarter( )`, `writeFile( )` in
`ai-agent.mjs`); a model building on `zcl_app` keeps it. The studio is the **AI Studio**
(`body.is-studio`, "AI Studio" at the end of `shell.css`): the site's bar, the
toolbar, the ABAP/App tabs and the splitter step aside, the studio's own bar
(`#studio-bar`: the stages, the status line mirrored by `setStatus( )`, browser
full screen; ✕ exists for a studio opened over the playground and is hidden on
its own page) runs across the top, the chat down the left, and a stage beside it shows
what `body[data-stage]` says - `preview` (the app frame, in a window of its
own), `code` (file strip, editor, panel), `split` (both), or on a phone `chat`,
where the stages take turns and the chat comes first. **Nothing is moved in
the DOM**: `.pane-left` dissolves into the grid with `display: contents` and
every pane keeps its element, because an iframe that is moved reloads - which
for the app frame would be a lost run and a lost model. Whatever is not on the
stage is hidden, never removed, so the models and their undo stacks survive
and Monaco's `automaticLayout` takes the size it is given. Two traps, both
held by `tests/ai.spec.js` on a phone: the page's visually hidden `<h1>` is a
box and took a grid cell until it was taken out of the flow, and the phone
layout's `inset` on `.pane` (room for the tabs) pushed the stage down and off
the screen until the studio took it back. The studio has its own palette in
both themes on purpose - it is the one room of the site that is not the
documentation - and answers `prefers-reduced-motion` for its own animations
(the stage's edge glow while the model works, the shimmer of a pending tool
row). A run that started the app is a card in the conversation
(`appUpdated( )`) that brings the app onto the stage. The editor follows the
file the model just wrote or edited (`host.show`). The model's answers are
markdown, rendered by `renderMarkdown( )` in `markdown.mjs` into nodes and never
through `innerHTML` - while it streams, drawn incrementally by
`streamMarkdown( )` rather than parsed whole again on every delta; the module
is shared with the Pilot, which no longer imports `chat.mjs` to get it. The app runs on the right. `tests/ai.spec.js` holds it with `api.anthropic.com`
answered by the test (the streamed events of the Messages API), so no test
talks to a model or needs a key.

- **The model has no back door.** Its tools (`TOOLS` in `ai-agent.mjs`) are the
  editor and Run: `write_file`, `edit_file` and `delete_file` go through
  `replaceWith( )` in `file-sets.mjs`, which is the path a sample takes (undoable,
  strip redrawn, draft stored by the change handler, `checkFileSet( )` refusing
  a name the editor cannot hold); `run_app` is `runForAgent( )`, which presses
  the real `run( )` (`agent-hooks.mjs`, `run.mjs`) — waiting out a run autorun started — then waits up to
  thirty seconds for the app's first roundtrip (as the Pilot waits for a
  tab; ten read as "none arrived" on a slow first boot) and hands back the
  status line, the problems, the tests, the roundtrips, the Log and
  `starting` (the frame still rendering, by the bridge's `busy( )`).
  `describeRun( )` turns that into what the model reads - errors and warnings
  as problems to fix, the linter's hints apart as optional advice, a frame
  still booting as "not an error", and a JavaScript error out of the app's
  start as a failed first roundtrip (the bridge's `roundtrip` lists it like
  an answer). `read_files` takes `names` and cuts each file on its own
  (`filesAsText( )`: two classes of 500 lines cut together at 24,000
  characters left the second unseen and then edited blind); `edit_file`
  matches exactly and once, else line by line with the whitespace at both
  ends forgiven and the file's indentation kept (`locate( )`); the app must
  be a class. So what the model is told is what the reader sees; keep it
  that way when adding a tool.
- **The studio tries what it built.** `look` and `act` are the Pilot's eyes
  and hands on Run's own frame: the mirror and the operator moved to
  `src/shell/ai-operator.mjs` and the frame transport to
  `src/shell/frame-drive.mjs` (one driver per frame: the parked request the
  frames' `roundtrip( )` in `agent-hooks.mjs` takes - `room.takePilotRequest( )`, the room being
  the Pilot or the studio - and every answer it saw, kept until a mirror
  listens), so both rooms share them. `chat.mjs` makes the mirror with the
  agent's chunk and hands the agent `host.app`; a run that started ends its
  report on the screen as the agent snapshot (`screenAfterRun( )`), and an
  act with an event on a screen older than the one last told (`told`) is
  refused. The rules ask for the main path ONCE after a clean run, never
  before one. `tests/ai.spec.js` holds the act in the real app.
- **The key is the reader's, the request is the browser's.** Held in the
  page's memory for the visit and **never stored**: the playground runs ABAP
  from any link in this same origin, and on the playground a view's
  `core:HTML` in the app frame can read this origin's `localStorage` - a
  stored key was one shared link away from somebody else's account. A key an
  earlier version stored under `abap2ui5-playground:anthropic-key` is removed
  on load - by every page (`boot( )` in `main.mjs`), since the playground,
  embedded or not, is where a link's ABAP runs. Sent by the
  Anthropic SDK straight from the page (`dangerouslyAllowBrowser`, which sends
  the `anthropic-dangerous-direct-browser-access` header CORS needs). A key
  that is not tied to a workspace needs `anthropic-workspace-id` on every
  request: the optional second field of the key form, stored under
  `abap2ui5-playground:anthropic-workspace` and sent as `defaultHeaders`;
  `explainError( )` recognises the API's refusal and points at that field. No proxy,
  no server: the page stays a static file. Never in an embedded playground —
  the switch is hidden there (`shell.css`) and `setUpChat( )` is not called.
  **The app's code cannot reach the key on the AI pages.** On `/ai/` and
  `/pilot/` the app frame is sandboxed without `allow-same-origin`
  (`frameIsolated` in `page.mjs`, `isolate( )` in `frame-link.mjs`): an
  opaque origin, and messages the only channel between it and the page
  ([runtime.md](runtime.md) has the protocol), so a `core:HTML` script
  reaches neither the key form's DOM, nor the page's memory or `fetch`, nor
  this origin's storage. The ABAP itself - `WRITE '@KERNEL …'` included -
  runs in the runtime worker, on the site's origin but with no DOM and no
  `localStorage` (an earlier version of this note said it could read
  `localStorage`; a worker has none), and with CacheStorage, IndexedDB and
  nested workers taken away before any of it runs
  (`src/runtime/lockdown.mjs`), so it leaves nothing for a later visit
  either. The Pilot - which opens share links and `?src=` beside its key -
  still opens a link's code only once the reader said so
  (`src/shell/linked-code.mjs`, `#linked-dialog`; `startingFiles( )` in
  `starting-files.mjs`) and takes no gist (`REPOSITORY_HOSTS` in
  `deep-link.mjs`): not for the key any more, but because the app is what
  Claude reads and acts on, and an app written to mislead can steer the
  chat. The studio opens no links. On the playground the frame stays
  same-origin - the HTTP cache, the service worker and offline need it
  ([load-time.md](load-time.md)) - and a link's code (a fragment, `?src=`,
  `?gist=`) still opens and runs without asking, which is what nine links
  in ten are for. But the Share dialog's Gist section takes the reader's
  GitHub token there, so once a link's code has run (`markLinkedCodeRan( )`,
  called by `run( )` in `run.mjs`, for the rest of the visit), that section
  asks for a tick first (`#share-gist-caution`, `#share-gist-trust`, once
  per visit) before it takes a token. `tests/isolation.spec.js` holds the
  wall: code in the Pilot's app frame finds an opaque origin, no parent
  document, location or global, a storage of its own and no `caches`; the
  studio's frame carries the same sandbox.
- **The studio keeps its build, not its chat.** `AI_STORAGE_KEY`
  (`abap2ui5-playground:ai-files`, `agent-hooks.mjs`; written by
  `remember( )` in `main.mjs`) holds the files whenever they
  are not the untouched starter - a key of its own, so the playground's draft
  is never written over - and the welcome offers them back
  (`host.lastBuild( )`, `.chat-resume` in `chat.mjs`); the studio still
  starts on the minimal class every time. The conversation is not kept, and
  no `beforeunload` asks before the page goes: nothing on this site may keep
  a page out of the back/forward cache (`tests/bfcache.spec.js`); Export is
  the way to keep a conversation.
- **Its instructions come from the pin.** `ai-agent.mjs` imports
  `deps/abap2ui5/docs/agents/building-apps.md` as text (the `.md` loader in
  `build-site.mjs`) under `PLAYGROUND_RULES`, which says what is different
  here (no database, the libraries in `UI5_LIBRARIES`, Run as the validation).
  A pin bump moves the guide with the framework it describes; a guide moved or
  renamed upstream fails the build on the import.
- **One chunk, downloaded on use.** The guide is in
  `assets/ai-agent-<hash>.mjs`, imported the first time a message is sent; the
  SDK, which the AI Pilot's chunk imports as well, is a `chunk-<hash>.mjs` of
  its own (with `ai-common.mjs`). They count towards the `assets/*.mjs` budget
  like every chunk, but they are left out of the service worker's precache:
  precached, every visitor the worker installs for would download them.
  `precachedChunks( )` in `tools/service-worker.mjs` reads that off esbuild's module graph -
  the precache is what `shell.mjs` reaches without a dynamic import of
  `ai-agent.mjs`, `pilot-agent.mjs`, `chat.mjs` or `pilot.mjs` (the two
  rooms are chunks of their own since they left the shell) - because a
  shared chunk's name says nothing about who needs it. Once used, the worker keeps them like any
  chunk. What the two rooms share on screen (`chat-ui.mjs`, `markdown.mjs`)
  is a chunk of its own as well, outside the precache, and each AI page
  preloads it (`preloadsFor( )` in `tools/site-documents.mjs`).
- **The conversation is append-only** - with one way back. `messages` in
  `createAgent( )` is only ever pushed to — the model's thinking blocks are
  bound to the history they were written in. Hand edits between two messages
  are told to the model as an `<editor_files>` block on the next user message
  rather than by rewriting anything earlier - only the files that changed
  since it last saw them (`editorChanged( )`, against `seenFiles`), each cut
  on its own. `rewind( )` takes the LAST exchange out whole (the reader's
  message and what answered it, `turns`) for a message edited and sent again
  (✎ on the latest message, `offerEdit( )` in `chat.mjs`): nothing before it
  is touched, so what is left is still what the thinking blocks were written
  against. The files are not put back by it; a step that changed them offers
  them back under its answer (`addCheckpoint( )`), since Ctrl+Z is per file
  and knows no turn. Export writes the conversation as markdown
  (`transcript`, never the key). Tool inputs stream (`eager_input_streaming`), so each is
  validated before it touches the editor, a turn cut off at `max_tokens` never
  runs its tools, and all results of a turn go back in one message.
- **Files in a message**, as in the AI Pilot: the paperclip, a paste, or a
  drop anywhere on the studio's page or on its app (the frame's `drop`
  message, `chatDropped( )`), read by `attachments.mjs` into the blocks in
  front of the message's text. The chips, the paste and the page-wide drop
  are `src/shell/attach-ui.mjs`, the one implementation both chats use in the
  dress of their own room (`chat-file` here, `pilot-file` there); the kinds
  and the limit come from the agent chunk, imported the first time a file is
  added. The rules tell the model to build from them - a spreadsheet's rows
  as the internal tables' data rather than invented ones. `tests/ai.spec.js`
  holds the paperclip, a drop on the bar, a refused `.doc` and the blocks.
  `submit( )` in `chat-ui.mjs` (the one submit both rooms use) waits for
  `attaching.settled( )`: a file dropped a moment before Enter was still
  being checked in and rode silently on the NEXT message. `chat-ui.mjs` sets
  up the attaching for both rooms; listening for a drop on the page stays
  with each room (`listenForFileDrops( )`).
- **The reader's system, and what the app still needs from it**
  (`src/shell/target-system.mjs`). The model wrote 7.50 syntax whatever the
  reader's system was, and abaplint checked it at `v750`: a reader on 7.02
  downloaded a class that ran here and failed to activate at home. The
  header's **target system** (`#chat-target`: 7.02-7.31, 7.40, 7.50+ /
  S/4HANA, ABAP Cloud) IS abaplint's `version` - `setAbapRelease( )` on the
  studio's host (`agent-hooks.mjs`) applies it the way the Config tab's Apply
  does (the corpus parsed again, kept by `keepAbaplintSettings( )`, the
  problems counted afresh), and `playgroundRules( )` is told the release on
  every request (`host.abapRelease( )`), with what it rules out - 7.02 gets
  no inline declarations or constructor expressions and is told the guide's
  7.50 examples are to be translated, Cloud gets released APIs only. A
  release the Config tab set that the list does not carry is shown and told
  as abaplint names it. abaplint at `Cloud` checks the language version, not
  whether an SAP object is released; the rules say that part is the model's.
  What this page cannot check at all - a SELECT from the reader's tables, a
  BAPI, class or CDS view the model assumed - the model marks with a
  `" TODO(system): …` line above it, and the download lists those lines
  under the zip (`placeholderNotice( )` in `chat.mjs`, `systemTodos( )`) with
  the release the code was checked against, so "it ran here" is not read as
  "it runs on my system". `tests/ai.spec.js` holds the header (the check
  stops a DATA( ) at v702, the rules in the request, kept over a reload) and
  the download's list; `tests/node/target-system.test.mjs` the releases and
  the matching.
- **No key, no answer - so the welcome offers a local model.** While no key
  is held, the welcome carries "Use a model on your own machine": the key
  form turned to an OpenAI-compatible server at Ollama's address (unless a
  base URL is already set), the model's name to type. A local server takes
  no key and costs nothing; it needs a model that calls tools.
- **How well it builds is measured, not assumed** (`tests/ai-eval.spec.js`).
  The specs above answer the API themselves, so they hold the mechanics and
  say nothing about whether a model, with these rules and the guide, ends on
  an app that runs. `AI_EVAL_KEY=sk-ant-… npm test -- ai-eval` sends each
  task of `tests/fixtures/ai-eval-tasks.json` (a message, optionally a target
  system, texts the app must show) through the real page to the real API and
  appends a JSON line per task to `AI_EVAL_OUT` (default
  `test-results/ai-eval.jsonl`): clean or not (the last run started with no
  error or warning), the turns, the tool calls, the runs that stopped or had
  problems, the `TODO(system)` lines, the tokens and the seconds.
  `AI_EVAL_SPEED` picks the header's speed, `AI_EVAL_ONLY` a few tasks.
  Without a key the file holds no tests, so `npm test` and CI never reach a
  model. A change to the rules is judged over several runs of the set -
  one answer varies too much to compare two numbers.
- **Which API answers** (`src/shell/llm-provider.mjs`, both chats). The
  conversation is the Messages API's shape whatever answers it; a provider
  turns one request of it into a call and the answer back. `anthropic` is the
  SDK request below, unchanged - `tests/llm-provider.spec.js` holds it field
  for field. `openai` is any OpenAI-compatible server (OpenAI, Azure OpenAI,
  Ollama at `http://localhost:11434/v1`, LM Studio) reached with `fetch` at
  `{baseUrl}/chat/completions`, a bearer key when there is one: the system
  prompt as the first message, the tools as functions, a `tool_use` a
  `tool_call` with the same id and each `tool_result` a `tool` message
  answering it (an error said as `Error: …`, since there is no `is_error`),
  images as `image_url` parts, a PDF as a `file` part, a text document as
  text. Streamed over SSE and told as the Messages API's events, so
  `followStream( )` draws both the same. The key form picks it (a select, a
  base URL with the examples in a datalist, a model name; the speeds step
  aside, the usage shows no dollars); provider, base URL and model are
  remembered under `abap2ui5-playground:llm`, the key never. **A key goes
  only to the server it was typed for** (`keyTarget( )` in `llm-form.mjs`):
  another provider or base URL asks for its own, or sends none to a local
  server - an Anthropic key sent as some server's bearer is a key given away.
  The stored settings are read back by `readProviderSettings( )`, which
  takes a base URL only when it is `http(s)` (`httpUrl( )`) and otherwise
  falls back to the default - a link's ABAP runs in this origin and can
  write `abap2ui5-playground:llm`. And both key forms say where the key is
  going (`#<room>-key-target`, "Your key will be sent to <host>", from
  `keyHost( )`) whenever the base URL is not `https://api.openai.com/v1`,
  flagging plain `http` to a host that is not local.
  `tests/llm-provider.spec.js` and `tests/ai.spec.js` hold both.
  The help says what CORS asks: Anthropic answers a browser because of the
  `anthropic-dangerous-direct-browser-access` header the SDK sends, Ollama
  only with `OLLAMA_ORIGINS` set to this site, LM Studio with CORS on in its
  server settings. `tests/ai.spec.js` holds a studio turn against a local
  server answered by the test.
- **Model and request shape.** `SPEEDS` in `ai-agent.mjs`, picked in the chat
  header and asked before every request (`abap2ui5-playground:ai-speed`, kept
  only while it is not the default): Balanced is `claude-opus-5-5` at effort
  `medium` (that model's own default), Thorough the same at `high`, Fast
  `claude-sonnet-5-5` at `medium`. The model is the reader's choice; the page
  does not pick a cheaper one for them. The system prompt is cached
  (`cache_control`), and `fallbacks: "default"` behind the
  `server-side-fallback-2026-07-01` beta answers a request a safety classifier
  declines with the fallback model rather than stopping.
- **A long conversation clears its old tool results, server-side**
  (`CONTEXT_MANAGEMENT` in `ai-common.mjs`, beta
  `context-management-2025-06-27`, in both chats): `clear_tool_uses` from
  100,000 input tokens, the last ten tool uses kept, at least 40,000 tokens
  per clear, the tool INPUTS too (`clear_tool_inputs`: in the studio an input
  is the whole class the model wrote, resent with every request). A Pilot working through a list read a screen per act and ended
  on "the conversation has filled the model's context". Server-side because
  the history must stay append-only - the thinking blocks are bound to it -
  and late and in large steps because every clear costs the cache from that
  point on: it is a context-window guard, not a saving.
- **Where a turn's time goes, and what was done about it.** A model turn - the
  request, the thinking, the answer - is the unit of waiting, so the loop
  spends as few as it can: after a turn's file changes the page runs the app
  itself and appends the report to the result of the last change (the turn
  loop is `runTurnLoop( )` in `ai-common.mjs`, shared with the Pilot; the
  studio's tool handling is `runTools( )` in `ai-agent.mjs`, `FILE_TOOLS`), where the model used to spend a whole turn calling
  `run_app`; the rules ask for every change of a step in one message, and for
  the guide before the sample catalogue. Perceived time is the other half:
  `thinking.display: "updates"` (beta `thinking-display-updates-2026-08-18`)
  returns the model's notes between tool calls as text, shown as progress
  lines, and a tool call's row is written while its input streams
  (`pendingText( )` - a class counts its lines as it arrives) and finished in
  place when it has run. `followStream( )` in `ai-common.mjs` (both chats)
  parses that input itself, at most every 150 ms - never through the SDK's
  `inputJson` event, which parses the whole input on every delta and ended
  the stream when one delta left it unparsable. The log follows the answer
  only while the reader is at its end. Errors are
  said in the chat by `explainError( )` from the SDK's typed errors; a refused
  key brings the key form back.
