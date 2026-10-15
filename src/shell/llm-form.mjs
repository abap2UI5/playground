// The provider half of the two key forms (chat.mjs, pilot.mjs): which API
// answers, and for an OpenAI-compatible server its base URL and model. The
// markup is in index.html twice, once per room, with the room's prefix on
// every id; this reads and writes it for both. The key itself is not this
// module's: the rooms hold it in memory (see chat.mjs for why it is never
// stored), and only the provider, the base URL and the model are kept
// between visits (llm-provider.mjs).
import { BASE_URL_EXAMPLES, PROVIDERS, readProviderSettings, writeProviderSettings } from "./llm-provider.mjs";

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
  }
  el.provider.addEventListener("change", reflect);

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
