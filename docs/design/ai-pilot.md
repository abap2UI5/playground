# The AI Pilot

> Design notes, moved out of `AGENTS.md`. Read this before touching `pilot.mjs`, `pilot-agent.mjs`, `ai-operator.mjs`, `frame-drive.mjs`, `attachments.mjs` or `src/vendor/agent/`.
> The rules in short, and every other area, are in [AGENTS.md](../../AGENTS.md).

## The AI Pilot — `src/shell/pilot.mjs`, `src/shell/pilot-agent.mjs`

**Claude operates the running app; the reader steers in the chat.** A page of
its own and, like the studio, no door from the playground while it is being
built: `pilot/index.html`, written by `writePilotPage( )` in
`tools/site-documents.mjs` exactly as `writeAiPage( )` writes the studio's -
`<base href="../">`, `data-page="pilot"`, its own title, `noindex`, no
canonical link. `page.mjs` reads `data-page` (`pilotPage`): the editor opens on what a link
carries (`#` fragment or `?src=`) or on the default sample, never on the
stored draft, and nothing is stored over it; `setUpPilot( )` gets a small host
from `setUpPilotHooks( )` in `agent-hooks.mjs` (Run as `runForAgent( )`, files in place of the open ones, a carried sample by
class, a catalogued class by its raw URL, the samples browser, Run's frame). The room is `body.is-pilot` ("AI Pilot" at the end of
`shell.css`), its own palette in both themes and deliberately not the
studio's: the app has the stage, the chat stands to its right, **What Claude
sees** (the snapshot, `describeMirror( )`) opens between them, and on a phone
the app and the chat take turns (`body[data-view]`). The editor and its panel
are hidden, never removed.

What the room shares with the studio's chat on screen - the log and its rows,
the key form, Send and Stop, the speed, the files for the next message and one
submit - is `createChatRoom( )` in `src/shell/chat-ui.mjs`; the answers are
drawn by `src/shell/markdown.mjs`. The Pilot no longer imports `chat.mjs`.
Listening for a file dropped on the page stays with the room.

**How the model reaches the app is the abap2UI5 agent protocol** - the agent
snapshot and the act of `abap2UI5/mcp-server` (`docs/agent-snapshot.md`
there), through that server's own client, vendored unchanged into
`src/vendor/agent/`. The client takes a `transport`; here the transport is
**the app frame**, so nothing is simulated and the reader sees every step:

1. `drive(body)` in `pilot.mjs` parks the client's request and asks the frame
   to send a roundtrip - a `roundtrip` call by message (`frameApi( )` in
   `frame-link.mjs`; `pilot.roundtrip( )` in `frontend-bridge.js`: busy,
   timers cancelled, `Server.roundtrip( )` of the frontend's own component).
   `drive( )` in `frame-drive.mjs` takes the call's promise.
2. The frames' `roundtrip( )` in `agent-hooks.mjs` (`offerFrameBridge( )`)
   takes the parked request (`takePilotRequest( )`) and sends **it** to the
   framework in place of the frame's body.
3. The answer goes back to the frame, which renders it with its own code - a
   popup opens, a MessageBox comes up - and to the client.

**Two copies of the screen, kept apart on purpose.** The *mirror*
(`createMirror( )`) is the screen as it is: every answer the frame got, the
reader's clicks included, passes `sawRoundtrip( )` and is folded with the
snapshot module's own `applyResponse( )`; a request without a draft id (an
app start - Run, a sample, a restart) starts it over. The client's *session*
is what the model acts through: whenever the mirror has moved on, a new one is
started from it (`replayOf( )` - the mirror as ONE answer, given to the
client's start by the transport instead of being sent). So the model always
acts on the screen the reader is looking at, and the reader can take the
controls at any moment - the next message carries the new screen in a
`<screen>` block, as the first message does.

**Nothing is read off the frame's window.** The page and the frames speak by
message only ([runtime.md](runtime.md)), and on this page every frame - Run's
and each tab's, isolated in `addTab` before its first load - is on an opaque
origin. What the operator used to read off the frame (`busy`, `slots`,
`pending`) is answered from the frame's last pushed `state` report; what it
does (`roundtrip`, `frontend`, `fill`, `carry`) is a `call`. The handle is
`frameApi( )`: `busy( )` stays true until the report has caught up with the
last call (`seen`), and `ai-operator.mjs` asks `refresh( )` for a fresh report
before it reads slots or pending values.

Details that are easy to undo:

- **Read the screen after the frame has settled** (`settled( )`, the bridge's
  `busy( )`): the answer is in the mirror the moment the framework gives it,
  the popup it opens a moment later, and a frame asked too early reads as one
  whose popup was closed. An app's FIRST answer is rendered without the
  frontend ever saying busy, so `busy( )` also counts a frame with no main
  view yet - under load the Pilot otherwise acted on a frame that had not
  drawn the app, and the values it typed went nowhere on screen.
- **The mirror folds the request's model delta too** (`withDelta( )`). An
  answer without a `MODEL` means "nothing bound changed", and the client keeps
  what it sent - the reader's typing or the Pilot's. Folded from the answers
  alone, the mirror kept the values from BEFORE, and the model was told a
  field it had just filled was empty.
- **A popup closed in the browser costs no roundtrip**, so the mirror would
  never hear of it: `catchUpWithFrame( )` asks the frame which slots hold a
  view and closes the others. The model's own `@CLOSE_POPUP` is performed in
  the frame through the frontend's `eF` and in the mirror alike.
- **Values are typed, then the button pressed** - an act with both runs as
  two client acts, values first: they are pending in the session and are
  written into the frame's model and marked changed (`fill( )`, the way
  typing marks them), so the reader sees them arrive, and a click of the
  reader's own would carry them on. The request that goes out is the one a
  single act would send. An act whose event is not there to press (unknown,
  disabled) is refused as ONE act, before anything is typed.
- **What the Pilot's request carried is cleared in the frame.** Its
  roundtrip goes around `View1.eB`, where the frontend notes what a request
  carries (`_z2ui5SentValues`, `oSentModel`), so the bridge notes it instead
  (`carry( )` in `frontend-bridge.js`): the paths it filled and the reader's
  unsent edits it took over. Left marked, a typed path was put back over
  every later answer and sent again with the reader's next click.
- **The reader's unsent typing is part of the screen.** Typing costs no
  roundtrip, so the mirror never hears of it: `current( )` takes the frame's
  pending values (`pending( )` on the bridge, the topmost view) into the
  session it builds and hands back what the session took (`carry( )`) - a
  value it could not take stays pending for the reader's own click - and an
  app whose typing changed counts as changed for
  the next message's `<screen>`. Each app is marked told when its screen is
  read (`snapshotText( )`), not wholesale after every tool round.
- **An event is pressed only on the screen the model saw.** The tools of one
  answer were all written for the screens told before it (`shownAt`, frozen
  per batch from `told`): an act whose app's mirror moved on since - an
  earlier act of the same answer, a click of the reader's while the model
  thought, or one during the pause between typing and pressing - is
  refused with the screen as it is now, nothing typed or pressed. Two
  `act a1` in one answer pressed NEXT and then the next screen's a1. And an
  app the answer was not written for at all - opened by `open_app` in the
  same answer, or by the reader's + App while the model thought - is a
  screen the model has not seen (`shownAt` has no entry): the act was
  written blind, and is refused the same way.
- **A screen is fitted, never cut mid-JSON** (`fitSnapshot( )`, as
  mcp-server's): long values cut to 2,000 characters and read-only, then
  rows from the end of the largest table, the JSON whole and `cut` saying
  what is missing - a 120 KB TextArea pushed every action out of a 30,000
  character `clip( )`. The `<screen>` of one message holds 60,000 for all
  apps together; a dump (`lastAnswer`) is 2,000 at most and comes after the
  screen.
- **`read_source` cuts each class on its own** (`MAX_FILE_TEXT`,
  `MAX_FILES_TEXT`) rather than all of them as one text at 30,000: with two
  apps open the second one's class was never seen. A run or an open that
  did not start says the first abaplint errors with their lines
  (`notStarted( )`), not only "1 error in the ABAP".
- **A tool argument the tool does not take is refused** (`execute( )`
  against the tool's `input_schema`), `row`/`max_rows` are whole numbers
  (a string of digits too), `beside` a boolean - dropped without a word,
  `act { value, event }` pressed without the values. Errors and chat rows
  repeat at most 80 characters of an argument; a closed tab's operator is
  let go (`prune( )`).

**Several apps, a tab each** (at most four, `.pilot-tabs` over the stage). Tab
1 is Run's own frame and the class of the first file; the others are frames
`pilot.mjs` creates, loading their class at the current Run with
`?pilot=<tab>` in their address - which is how the bridge knows whose
roundtrip it is (`takePilotRequest(from)`, `sawRoundtrip(…, from)`) and each
tab keeps a mirror of its own. The runtime defines a set of classes as a
whole (`defineClasses( )` puts back whatever the last set shadowed), so an
app opened beside the others is not compiled alone: `addAppFiles( )` in
`agent-hooks.mjs` puts its files into the editor beside the rest and compiles and
defines the WHOLE set - and stops there, with no fresh database and no Run
counted, so the apps already open keep their drafts and their frames stay
current. A set that does not compile is put back as it was - left in, every
later open and every Restart failed on it, behind an editor this page hides.
Replacing tab 1's app makes its file the first, so Restart starts it
from then on. A Run (Restart, `restart_app`) is one fresh database for all of
them, so `pilotRan( )` reloads every other tab on the new Run number, or
closes one whose class left the files - and the Pilot's `run` waits until
every tab has started again before it reads a screen. A step parked for a
frame that a Run replaced is refused with it, and never handed to the new
document's app start (`offerFrameBridge( )` in `agent-hooks.mjs`). A pick in the samples browser goes to
the Pilot on this page (`pilotPicked( )`): in place of the app on screen, or
beside after the strip's **+ App**, and a catalogue row of a sample the page
carries opens that copy instead of fetching it; a saved draft is a pick like
any other. The playground's Run shortcut (Ctrl+Enter, Ctrl+S) is off on this
page and in the studio's chat, where Ctrl+Enter is "send". Autorun is never restored on
this page: a change to the files is an app opened beside, and a run would
restart them all.

**Files in the chat** (`src/shell/attachments.mjs`, in the Pilot's chunk and
the studio's; on screen `src/shell/attach-ui.mjs`, shared with the studio):
📎, a drop or a paste adds up to five files of at most 10 MB (an image
7.5 MB - the API's 10 MB is of the base64; an empty file none) to the next
message, the PDFs and images of one message 20 MB together
(`MAX_MESSAGE_BYTES` - they go as base64, and a request is at most 32 MB),
checked as they are added (`kindOf( )`) and read when it is
sent (`attachmentBlocks( )`), in front of its text; the text read out of all
of them is capped at 400,000 characters together, not only per file. A paste
that carries text as well as a picture of it (cells copied in Excel, a passage
in Word) is the text, not an image chip. A PDF is a `document`
block and an image an `image` block, as they are; an `.xlsx` is each sheet as
CSV, a `.docx` its paragraphs and its tables as tab-separated rows, a `.pptx` the
text of each slide, a text file its text - each a text
`document` with the file's name as its title - a text file decoded by its
BOM, else as UTF-8, else as Windows-1252 (an Excel CSV, a SAP GUI download),
a sheet's CSV line N its row N (empty rows kept), a text box in a `.docx`
once (not again from `mc:Fallback`). The two Office formats are zip
files of XML, read here rather than with a library: `readZip( )` walks the
central directory and inflates an entry with the browser's own
`DecompressionStream("deflate-raw")`, DOMParser reads the XML. A date cell
comes as `YYYY-MM-DD` (with its time when it has one): `dateStyles( )` reads
which `cellXfs` carry a date format off `styles.xml` - the built-in ids and a
custom code with a day, month, year, hour or second outside quotes and
brackets - and `serialToDate( )` counts from 1899-12-30, or 1904 when
`workbookPr` says so. What CSV cannot carry (a formula is its last result) is
said in the sheet's first line. The old binary formats are refused with what to save
them as. The conversation is append-only, so the files are sent again with
every request of the chat - the conversation's `cache_control` is what keeps
that cheap. One exception to append-only: a message the API refuses as it
stands (a 400 or a 413) with nothing answered after it is taken back out
(`send( )` in `pilot-agent.mjs`) - resent with every later request, it was
refused with every one of them. `tests/pilot.spec.js` holds the three formats against fixtures
(`tests/fixtures/orders.xlsx`, `brief.docx`, `note.pdf`). **A drop is taken
anywhere on the page**, not only on the chat: a file dropped where nobody
takes it is opened by the browser in a tab of its own, which is what a drop
on the bar or the app did. The page listens on the window; the app's frame
hands a drop to the page (a `drop` message, only where the page's
`settings` said it takes files; `pilotDropped( )`)
unless one of the app's own controls took it first (`defaultPrevented` - an
upload control).

**The conversation is kept for the tab** (`CONVERSATION_STORAGE`,
`keepConversation( )` in `pilot.mjs`, as the studio's - [ai-chat.md](ai-chat.md)):
after every turn the agent's `state` (the history and the usage, never the
key) and the log as text go to sessionStorage, and the next load of the
same tab draws the log again (`restoreConversation( )`) and hands the
state to the agent as `resume` when it is made. No screens are kept: the
apps start again with the page, `told` starts empty, and the next message
carries every screen as "changed" - a conversation taken up is never the
"first" one (`send( )`). New chat forgets it; a key typed for a
conversation waiting to be taken up does not start it over. The welcome
offers a model on the reader's own machine while no key is held
(`localModelOffer( )` in `chat-ui.mjs`, both rooms), and the room says
"Claude" only for the Anthropic provider (`who( )`; "What Claude sees"
follows it).

The tools are `look`, `act`, `restart_app`, `find_apps`, `open_app` (with
`beside`), `show_app`, `close_app` and `read_source` - the apps, Run and the
catalogue, and nothing else. `look`, `act` and `restart_app` take `app` (a
tab number or a class) and default to the app on screen; an act on another
tab brings it on screen first - once its event is known to be on that
screen, so a refused act switches no tab - and every snapshot the model
reads carries its `tab`. The
conversation is append-only and asks the same model at the same speeds as
the studio (`ai-common.mjs`); the key follows the studio's rule word for word
(memory only, never stored). `tests/pilot.spec.js` answers `api.anthropic.com`
itself and holds the act in the real app (the ABAP ran, the frontend rendered
the answer), a refused act sending nothing, the reader's own click reaching the
model, a popup worked through in another app, a value typed without an event,
two apps worked side by side and one closed, Restart restarting every tab, the
snapshot panel, the phone, and the vendored copies against `source.json`.
