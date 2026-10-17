// The provider half of the two key forms (chat.mjs, pilot.mjs): which API
// answers, and for an OpenAI-compatible server its base URL and model. The
// markup is in index.html twice, once per room, with the room's prefix on
// every id; this reads and writes it for both. The key itself is not this
// module's: the rooms hold it in memory (see chat.mjs for why it is never
// stored), and only the provider, the base URL and the model are kept
// between visits (llm-provider.mjs).
import { BASE_URL_EXAMPLES, PROVIDERS, keyHost, readProviderSettings, writeProviderSettings } from "./llm-provider.mjs";

/** The server a key belongs to: Anthropic, or one base URL. A key held in
 *  memory is sent to that server and no other (chat.mjs, pilot.mjs). */
export const keyTarget = (settings) =>
  settings.provider === "openai" ? `openai ${settings.baseUrl}` : "anthropic";

export function setUpProviderForm(prefix) {
  const el = {
    provider: document.getElementById(`${prefix}-provider`),
    openai: document.getElementById(`${prefix}-openai`),
    baseUrl: document.getElementById(`${prefix}-base-url`),
    baseUrls: document.getElementById(`${prefix}-base-urls`),
    model: document.getElementById(`${prefix}-model`),
    keyLabel: document.getElementById(`${prefix}-key-label`),
    keyInput: document.getElementById(`${prefix}-key-input`),
    workspace: document.getElementById(`${prefix}-workspace`),
    noteAnthropic: document.getElementById(`${prefix}-key-note`),
    noteOpenai: document.getElementById(`${prefix}-key-note-openai`),
    target: document.getElementById(`${prefix}-key-target`),
  };
  for (const { url, label } of BASE_URL_EXAMPLES) {
    const option = document.createElement("option");
    option.value = url;
    option.label = label;
    el.baseUrls.append(option);
  }

  // The fields that belong to the provider picked, and the words on the key.
  function reflect() {
    const provider = PROVIDERS[el.provider.value] ? el.provider.value : "anthropic";
    const openai = provider === "openai";
    el.openai.hidden = !openai;
    el.workspace.hidden = openai;
    el.noteAnthropic.hidden = openai;
    el.noteOpenai.hidden = !openai;
    el.keyLabel.textContent = PROVIDERS[provider].keyLabel;
    el.keyInput.placeholder = PROVIDERS[provider].keyPlaceholder;
    sayWhereTheKeyGoes();
  }
  el.provider.addEventListener("change", reflect);

  // Where the key goes, said beside the key field before it is typed,
  // whenever that is not the provider's own server. The base URL is
  // remembered (llm-provider.mjs) and a link's ABAP can write what is
  // remembered (linked-code.mjs): a base URL put there by somebody else was
  // the next key typed here, sent to their server with nothing on the form
  // to say so. Said from the fields as they stand, so a URL being typed is
  // said as it is typed - and over plain http to another machine, said too.
  function sayWhereTheKeyGoes() {
    if (!el.target) return;
    const where = keyHost(read());
    el.target.hidden = !where;
    if (!where) return;
    const host = document.createElement("strong");
    host.textContent = where.host;
    el.target.replaceChildren(
      "Your key will be sent to ",
      host,
      where.plain ? " - over plain http, readable on the way." : ".",
    );
  }
  el.baseUrl.addEventListener("input", sayWhereTheKeyGoes);

  /** The fields as they stand, completed with the defaults. */
  const read = () =>
    readProviderSettings({ provider: el.provider.value, baseUrl: el.baseUrl.value, model: el.model.value });

  /** Puts what is stored into the fields - on every open, so a field left
   *  half edited goes back to what counts. */
  function fill(settings = readProviderSettings()) {
    el.provider.value = settings.provider;
    el.baseUrl.value = settings.baseUrl ?? "";
    el.model.value = settings.model ?? "";
    reflect();
  }

  /** Keeps the fields and answers them. */
  function save() {
    const settings = read();
    writeProviderSettings(settings);
    fill(settings);
    return settings;
  }

  fill();
  return {
    fill,
    save,
    read,
    /** Whether a key is needed at all - a local server takes none. */
    keyRequired: () => !PROVIDERS[read().provider].keyOptional,
  };
}
