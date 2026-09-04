// Which samples the playground carries, by name only.
//
// Not one line of ABAP, and no prose about what a sample shows: every sample
// here is a class in **abap2UI5/samples**, pinned by commit in
// `tools/fetch-deps.mjs`, and its title and its blurb come out of that
// repository's own `catalogue.json`. `tools/build-site.mjs` resolves the list
// into `build/samples/` before it bundles.
//
// The playground used to keep hand-written copies of a dozen samples under
// `src/samples/`. Every one of them was a fork: improved upstream and not
// here, or improved here and nowhere else, and nothing on the page said which.
// A reader who followed a row to GitHub landed in this repository rather than
// in the corpus the rest of the samples browser lists. There is one place
// abap2UI5 samples are written now, and it is not this one.
//
// What this list is FOR, then, is the handful that has to work with no network
// at all: the app the page opens on and the rows the samples browser can offer
// before - or without - the catalogue. Everything else in the three sample
// repositories is one click away in that browser and arrives over `?src=`.
//
// Adding one is a class name. The build fails if the pinned catalogue does not
// have it, which is what makes a sample renamed upstream a red build somebody
// is looking at rather than a page that quietly opens on something else.
//
// `also` names the further classes a sample needs open beside it - an app it
// calls with `nav_app_call`. The first file is always the app.
export const SAMPLE_LIST = [
  { id: "hello", class: "z2ui5_cl_smp_app_493" },
  { id: "binding", class: "z2ui5_cl_smp_app_494" },
  { id: "lifecycle", class: "z2ui5_cl_smp_app_495", also: ["z2ui5_cl_smp_app_493"] },
  { id: "roundtrips", class: "z2ui5_cl_smp_app_004" },
  { id: "table", class: "z2ui5_cl_smp_app_019" },
  { id: "table-edit", class: "z2ui5_cl_smp_app_011" },
  { id: "message", class: "z2ui5_cl_smp_app_008" },
  { id: "value-help", class: "z2ui5_cl_smp_app_009" },
  { id: "navigation", class: "z2ui5_cl_smp_app_024", also: ["z2ui5_cl_smp_app_025"] },
];

// The repository they come from, for the pin, for the row's GitHub link, and
// for the blurb the samples browser puts over the group.
export const SAMPLE_REPO = "abap2UI5/samples";
