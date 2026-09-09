// "On this page" marks the section being read.
//
// The walk every chapter of the documentation does, case for case: the
// heading whose top has passed the line under the bar is the section you are
// in, -1 above the first one because there is no section to be in there, and
// the last row once the page is scrolled to the end whether or not its
// heading ever crossed. It used to travel as an inline script on every sample
// page; it is a module now, one file for all of them (page-entry.mjs).
export function setUpOutline() {
  const nav = document.querySelector(".outline nav");
  if (!nav) return;
  const links = [...nav.querySelectorAll("a")];
  const heads = links.map((a) => document.getElementById(decodeURIComponent(a.getAttribute("href").slice(1))));
  if (!heads.length || heads.includes(null)) return;

  /* The bar is 46px and sticky, plus the air a heading needs under it before
     it counts as reached. The same number the outline's own `top` uses. */
  const LINE = 70;
  let at = -1;

  const mark = () => {
    let last = -1;
    if (window.scrollY >= 1) {
      for (let i = 0; i < heads.length; i++) {
        if (heads[i].getBoundingClientRect().top <= LINE) last = i;
      }
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 2) last = heads.length - 1;
    }
    if (last === at) return;
    if (at > -1) links[at].classList.remove("here");
    if (last > -1) links[last].classList.add("here");
    at = last;
  };

  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      mark();
    });
  };

  mark();
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule, { passive: true });
}
