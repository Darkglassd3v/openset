const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// Older iPads on stage (iOS 12-14) must still run the UI: no syntax or CSS they lack
const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf-8");
const script = html.slice(html.lastIndexOf("<script>"), html.lastIndexOf("</script>"));
const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

test("ui: no ?? or ?. (iOS < 13.4 cannot parse the page)", () => {
  assert.deepEqual(script.match(/\?\?|\?\.[\w$[(]/g) || [], []);
});

test("ui: no inset property (iOS < 14.5 ignores it)", () => {
  assert.deepEqual(style.match(/(^|[;{\s])inset\s*:/g) || [], []);
});
