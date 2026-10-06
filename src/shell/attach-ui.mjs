// Files for the next message of a chat, on screen: the paperclip, the chips
// above the message, a paste into it, and a drop anywhere on the page. Shared
// by the site's two chats - the AI Pilot's (pilot.mjs) and the AI Studio's
// (chat.mjs) - each in the dress of its own room, by the class prefix.
//
// What a file BECOMES is not decided here: `rules()` hands over kindOf and
// MAX_FILES from src/shell/attachments.mjs, which lives in each chat's own
// chunk, so a reader who never adds a file downloads none of it. The files
// are checked as they are added - a format the chat cannot read is said at
// once, not after Send - and read only when the message goes.

const sizeOf = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 *   prefix     the room's class prefix: chips are `${prefix}-file`
 *   button     the paperclip;  input   its hidden <input type=file>
 *   list       where the chips go;  textarea  the message (pastes, focus)
 *   rules()    a promise of { kindOf, MAX_FILES } (attachments.mjs)
 *   refused(text)  says why a file was left out, in the chat
 *
 * Answers { add(files), take() } - take( ) empties the list and answers it.
 */
export function setUpAttaching({ prefix, button, input, list, textarea, rules, refused }) {
  let attached = [];

  function render() {
    list.hidden = attached.length === 0;
    list.replaceChildren(
      ...attached.map((file) => {
        const chip = document.createElement("span");
        chip.className = `${prefix}-file`;
        chip.append(`${file.name} · ${sizeOf(file.size)}`);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = `${prefix}-file-remove`;
        remove.textContent = "×";
        remove.title = `Remove ${file.name}`;
        remove.setAttribute("aria-label", `Remove ${file.name}`);
        remove.addEventListener("click", () => {
          attached = attached.filter((f) => f !== file);
          render();
        });
        chip.append(remove);
        return chip;
      }),
    );
  }

  async function add(files) {
    if (files.length === 0) return;
    let loaded;
    try {
      loaded = await rules();
    } catch (e) {
      refused(`The files could not be taken - the chat's code did not load: ${String(e?.message ?? e)}`);
      return;
    }
    for (const file of files) {
      const kind = loaded.kindOf(file);
      if (kind.error) {
        refused(kind.error);
        continue;
      }
      if (attached.length >= loaded.MAX_FILES) {
        refused(`${file.name} was left out - ${loaded.MAX_FILES} files go with one message`);
        continue;
      }
      if (!attached.some((f) => f.name === file.name && f.size === file.size)) attached.push(file);
    }
    render();
    textarea.focus();
  }

  button.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    add([...input.files]);
    input.value = "";
  });
  textarea.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length === 0) return;
    e.preventDefault();
    add(files);
  });

  return {
    add,
    get count() {
      return attached.length;
    },
    take() {
      const taken = attached;
      attached = [];
      render();
      return taken;
    },
  };
}

/*
 * A file dropped ANYWHERE on the page goes to `onFiles` - on the bar, beside
 * the chat, on the stage - because the browser's own answer to a drop nobody
 * takes is to open the file in a tab of its own. `highlight` is lit while a
 * file is dragged over the page. A drop something else on the page took
 * first (defaultPrevented - the editor, say) stays its. A drop on the app is
 * handed over by its frame (frontend-bridge.js, dropFiles in main.mjs).
 */
export function listenForFileDrops({ highlight, onFiles }) {
  const isFileDrag = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  window.addEventListener("dragover", (e) => {
    if (e.defaultPrevented || !isFileDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    highlight.classList.add("is-dropping");
  });
  window.addEventListener("dragleave", (e) => {
    // Leaving the window, not crossing from one element to the next.
    if (e.relatedTarget === null) highlight.classList.remove("is-dropping");
  });
  window.addEventListener("drop", (e) => {
    highlight.classList.remove("is-dropping");
    if (e.defaultPrevented || !isFileDrag(e)) return;
    e.preventDefault();
    onFiles([...(e.dataTransfer?.files ?? [])]);
  });
}

/** The files a sent message carried, listed under it in the conversation. */
export function listSentFiles(message, files, className) {
  if (files.length === 0) return;
  const listed = document.createElement("span");
  listed.className = className;
  listed.textContent = files.map((f) => `📎 ${f.name}`).join("\n");
  message.append(listed);
}
