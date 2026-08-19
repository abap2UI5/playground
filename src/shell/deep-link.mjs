// Opening ABAP that lives somewhere else.
//
//   ?src=https://raw.githubusercontent.com/abap2UI5/samples/main/src/z2ui5_cl_demo.clas.abap
//
// This is what a documentation page links when it wants to show one of its
// examples running rather than only printed. Several `src` parameters may be
// given; the first is the app, because the playground starts the class in the
// first file.
//
// Where a file may come from is deliberately narrow. The playground fetches on
// behalf of whoever opened the link, so an unrestricted parameter would make it
// a small proxy for reading arbitrary URLs into a page under this origin.
// Same-origin plus GitHub's raw hosts covers the reason the feature exists.
const ALLOWED_HOSTS = ["raw.githubusercontent.com", "gist.githubusercontent.com"];

export const linkedSources = (params) => params.getAll("src").filter(Boolean);

function checkAllowed(url) {
  if (url.origin === window.location.origin) return;
  if (url.protocol === "https:" && ALLOWED_HOSTS.includes(url.hostname)) return;
  throw new Error(
    `The playground only opens ABAP from ${ALLOWED_HOSTS.join(" or ")}, or from its own site. ` +
      `This link points at ${url.hostname}.`,
  );
}

// The file name an object is given once it is here. abapGit's own name is in
// the URL, and it is the name abaplint needs, so it is simply kept.
function nameFrom(url) {
  const last = url.pathname.split("/").pop() ?? "";
  if (!/\.(clas|intf)\.abap$/.test(last)) {
    throw new Error(
      `${last || url.href} is not an ABAP object file. A link points at a .clas.abap or a .intf.abap.`,
    );
  }
  return last.toLowerCase();
}

// Where each linked file came from, so the page can offer the way back to it.
// Filled by fetchLinkedFiles and read by the bar; empty for code that arrived
// any other way, which is what keeps the button from appearing over a draft
// nobody linked.
const origins = new Map();

export const originOf = (fileName) => origins.get(fileName);

// The page a human would want, from the URL a machine was given. GitHub serves
// raw content from a different host than the one that shows it in context, and
// context is the whole point of the button: the repository, the neighbouring
// files, the history.
export function humanUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.hostname === "raw.githubusercontent.com") {
      const [owner, repo, ref, ...path] = url.pathname.replace(/^\//, "").split("/");
      if (owner && repo && ref && path.length > 0) {
        return `https://github.com/${owner}/${repo}/blob/${ref}/${path.join("/")}`;
      }
    }
    if (url.hostname === "gist.githubusercontent.com") {
      const [owner, id] = url.pathname.replace(/^\//, "").split("/");
      if (owner && id) return `https://gist.github.com/${owner}/${id}`;
    }
    return raw;
  } catch {
    return raw;
  }
}

// The classes this source needs from beside it. For an abap2UI5 app that is
// very nearly the list of apps it navigates to - nav_app_call( NEW zcl_detail( ) )
// is the shape - but a static helper (zcl_util=>do( )) is the same problem: the
// file does not compile without it either, so both are followed.
//
// Read off the text because there is no registry yet: this runs before the
// corpus has even been fetched.
//
// Framework prefixes are dropped: those objects are in the corpus already, and
// asking a sample repository for cl_abap_typedescr.clas.abap would be one
// pointless 404 per name.
const FRAMEWORK = /^(z2ui5_|cl_|cx_|if_|cf_)/i;

export function instantiatedClasses(source) {
  const names = new Set();
  const add = (name) => {
    if (name && !FRAMEWORK.test(name)) names.add(name.toLowerCase());
  };
  // Comments are stripped first, or the sentence "this app calls zcl_helper"
  // in a header comment would be followed as if it were code.
  const code = source.replace(/^\s*".*$/gm, "").replace(/\s".*$/gm, "");
  for (const [, name] of code.matchAll(/\bNEW\s+([a-z_]\w*)\s*\(/gi)) add(name);
  for (const [, name] of code.matchAll(/\bCREATE\s+OBJECT\s+\w+\s+TYPE\s+([a-z_]\w*)/gi)) add(name);
  for (const [, name] of code.matchAll(/\b([a-z_]\w*)\s*=>/gi)) add(name);
  for (const [, name] of code.matchAll(/\bTYPE\s+REF\s+TO\s+([a-z_]\w*)/gi)) add(name);
  return [...names];
}

// Follows those names to the files next to the one that was linked, so a link
// to an app that calls another app opens both. Deliberately narrow:
//
//   - only siblings, in the directory the linked file came from. Guessing at
//     other paths would be guessing.
//   - only what the allow list already permits, checked the same way as a
//     linked URL, because that is what it is.
//   - bounded in depth and count. A repository where every app calls two others
//     would otherwise pull itself into the editor.
//   - silent when a name is not there. Most are not: a class can be in the same
//     package under another path, or in the corpus, or dynamic - none of that
//     is an error worth stopping a link over.
const MAX_FOLLOWED = 6;
const MAX_DEPTH = 2;

export async function followNavigation(files) {
  const found = [];
  const seen = new Set(files.map((f) => f.name));
  let frontier = files;

  for (let depth = 0; depth < MAX_DEPTH && found.length < MAX_FOLLOWED; depth++) {
    const wanted = new Map();
    for (const file of frontier) {
      const from = origins.get(file.name);
      if (from === undefined) continue;
      for (const name of instantiatedClasses(file.source)) {
        const fileName = `${name}.clas.abap`;
        if (seen.has(fileName) || wanted.has(fileName)) continue;
        wanted.set(fileName, new URL(fileName, from).href);
      }
    }
    if (wanted.size === 0) break;

    const fetched = (
      await Promise.all(
        [...wanted].slice(0, MAX_FOLLOWED - found.length).map(async ([name, href]) => {
          try {
            checkAllowed(new URL(href));
            const response = await fetch(href);
            if (!response.ok) return undefined;
            const source = await response.text();
            // A 404 page served with 200 is a real thing on some hosts, and an
            // HTML file in the editor helps nobody.
            if (!/^\s*(?:"|\*|CLASS|INTERFACE)/im.test(source)) return undefined;
            origins.set(name, href);
            return { name, source };
          } catch {
            return undefined;
          }
        }),
      )
    ).filter(Boolean);

    if (fetched.length === 0) break;
    for (const file of fetched) seen.add(file.name);
    found.push(...fetched);
    frontier = fetched;
  }

  return found;
}

export async function fetchLinkedFiles(params) {
  // Checked before anything is fetched: a link that is going to be refused for
  // its second file should not have cost a request for its first. The checks
  // are also what make the fetches safe to run together afterwards.
  const seen = new Set();
  const links = linkedSources(params).map((raw) => {
    let url;
    try {
      url = new URL(raw, window.location.href);
    } catch {
      throw new Error(`${raw} is not a URL.`);
    }
    checkAllowed(url);
    const name = nameFrom(url);
    if (seen.has(name)) {
      throw new Error(`Two of the linked files are both called ${name}, and an ABAP object has one name.`);
    }
    seen.add(name);
    return { name, url };
  });

  // Together, not one after another - the files are independent and this is the
  // startup path of every documentation link.
  return Promise.all(
    links.map(async ({ name, url }) => {
      const response = await fetch(url.href).catch(() => {
        // A cross-origin fetch that the other host does not allow fails without
        // a status, so this is the only place the reason can be guessed at.
        throw new Error(`${url.href} could not be fetched. The host has to allow being read from a browser.`);
      });
      if (!response.ok) {
        throw new Error(`${url.href} answered ${response.status}.`);
      }
      origins.set(name, url.href);
      return { name, source: await response.text() };
    }),
  );
}
