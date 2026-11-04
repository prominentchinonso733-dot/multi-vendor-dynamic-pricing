const assert = require("node:assert/strict");
const { test } = require("node:test");
const router = require("../routes/adminRoutes");

test("admin feature and commission endpoints are registered as top-level routes", () => {
  const paths = router.stack
    .filter((layer) => layer.route)
    .map((layer) => layer.route.path);

  assert.ok(paths.includes("/featured"));
  assert.ok(paths.includes("/commission-ledger"));
  assert.ok(paths.includes("/featured/:entity/:id"));
});
