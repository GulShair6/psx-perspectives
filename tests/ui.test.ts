import test from "node:test";
import assert from "node:assert/strict";
import { link } from "../app/expert-shared";
test("saved evidence links preserve video identity and support timestamped Shorts", () => {
  assert.equal(
    link("https://www.youtube.com/watch?v=abc123", 12.8),
    "https://www.youtube.com/watch?v=abc123&t=12s",
  );
  assert.equal(
    link("https://www.youtube.com/shorts/abc123", 0),
    "https://www.youtube.com/shorts/abc123?t=0s",
  );
  assert.equal(
    link("https://www.youtube.com/watch?v=abc123&t=99s", 12),
    "https://www.youtube.com/watch?v=abc123&t=12s",
  );
  assert.equal(
    link("https://dps.psx.com.pk/company/OGDC", null),
    "https://dps.psx.com.pk/company/OGDC",
  );
});
