// XML one element per line (src/shell/xml-pretty.mjs), the shape the View and
// Roundtrips tabs print a reconstructed view in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { prettyXml } from "../../src/shell/xml-pretty.mjs";
import { installDom } from "./dom.mjs";

installDom();

test("an element a line, indented by depth, attributes beside it", () => {
  const xml = '<mvc:View xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m"><Page title="Hi"><Button text="Go"/><Text>one word</Text></Page></mvc:View>';
  assert.equal(
    prettyXml(xml),
    [
      '<mvc:View xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m">',
      '  <Page title="Hi">',
      '    <Button text="Go"/>',
      "    <Text>one word</Text>",
      "  </Page>",
      "</mvc:View>",
    ].join("\n"),
  );
});

test("the indent is the caller's", () => {
  assert.equal(prettyXml("<a><b/></a>", "\t"), "<a>\n\t<b/>\n</a>");
});

test("values are escaped so the printed XML parses back to the same values", () => {
  const xml = '<a v="1 &lt; 2 &amp; {= %{x} > 1 } &quot;q&quot;" w="line&#xA;break&#x9;tab"><b>x &gt; y</b></a>';
  const printed = prettyXml(xml);
  // `>` stays readable in a value, and is escaped in text.
  assert.ok(printed.includes('v="1 &lt; 2 &amp; {= %{x} > 1 } &quot;q&quot;"'), printed);
  // A line break inside a value is a character reference, not a raw newline
  // the parser would normalise to a space.
  assert.ok(printed.includes('w="line&#xA;break&#x9;tab"'), printed);
  assert.ok(printed.includes("<b>x &gt; y</b>"), printed);
  assert.equal(prettyXml(printed), printed);
});

test("comments and CDATA are kept as written", () => {
  assert.equal(
    prettyXml("<a><!-- note --><b><![CDATA[<raw> & stuff]]></b></a>"),
    ["<a>", "  <!-- note -->", "  <b>", "    <![CDATA[<raw> & stuff]]>", "  </b>", "</a>"].join("\n"),
  );
});

test("what does not parse is returned as it came", () => {
  for (const bad of ["<a>", "<a><b></a>", "not xml at all"]) assert.equal(prettyXml(bad), bad);
});
