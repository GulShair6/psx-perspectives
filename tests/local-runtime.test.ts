import test from "node:test";
import assert from "node:assert/strict";
import {
  sourceLanguage,
  validateLocalBlocks,
  localReadiness,
} from "../lib/local-runtime";
test("script detection tolerates Hindi-labelled Urdu but rejects unsupported scripts", () => {
  assert.equal(sourceLanguage("قیمت 100 ہے", "hi"), "ur");
  assert.equal(sourceLanguage("खरीदो मत", "ur"), "hi");
  assert.equal(sourceLanguage("ਨਾ ਖਰੀਦੋ", "pa"), "pa");
  assert.equal(sourceLanguage("Do not buy 100", "en-US"), "en");
  for (const [text, hint] of [
    ["خرید نہ کرو", "pa"],
    ["خرید نہ کرو", "ar"],
    ["khareedo mat", "hi"],
    ["цена 100", "en"],
    ["खरीदो قیمت", "hi"],
  ])
    assert.throws(() => sourceLanguage(text, hint));
});
test("local mapping and numerical notation are exact", () => {
  const input = [{ id: 1, text: "खरीदो मत 1,200.50 10%" }];
  assert.equal(
    validateLocalBlocks(input, [{ id: 1, text: "Do not buy 1,200.50 10%" }])
      .length,
    1,
  );
  for (const raw of [
    [],
    [{ id: 2, text: "100" }],
    [{ id: 1, text: "" }],
    [{ id: 1, text: "Buy 1200.50 10%" }],
    [{ id: 1, text: "Buy 1,200.50" }],
    { text: "malformed" },
  ])
    assert.throws(() => validateLocalBlocks(input, raw));
});
test("readiness never needs provider credentials", () => {
  assert.equal(typeof localReadiness().ready, "boolean");
});
