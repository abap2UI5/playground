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

export async function fetchLinkedFiles(params) {
  const files = [];
  const seen = new Set();
  for (const raw of linkedSources(params)) {
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

    const response = await fetch(url.href).catch(() => {
      // A cross-origin fetch that the other host does not allow fails without
      // a status, so this is the only place the reason can be guessed at.
      throw new Error(`${url.href} could not be fetched. The host has to allow being read from a browser.`);
    });
    if (!response.ok) {
      throw new Error(`${url.href} answered ${response.status}.`);
    }
    files.push({ name, source: await response.text() });
  }
  return files;
}
