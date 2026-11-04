import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { currentSeason, escapeHtml, periodLabel, round1 } from "../../public/lib/format.js";

describe("escapeHtml", () => {
  it("escapes markup characters", () => {
    assert.equal(escapeHtml("<a href=\"x\">Tom & Jerry's</a>"), "&#60;a href=&#34;x&#34;&#62;Tom &#38; Jerry&#39;s&#60;/a&#62;");
  });

  it("turns null and undefined into an empty string", () => {
    assert.equal(escapeHtml(null), "");
    assert.equal(escapeHtml(undefined), "");
  });

  it("stringifies numbers", () => {
    assert.equal(escapeHtml(42), "42");
  });
});

describe("round1", () => {
  it("rounds to one decimal place", () => {
    assert.equal(round1(1.26), 1.3);
    assert.equal(round1(-0.04), -0);
  });
});

describe("periodLabel", () => {
  it("labels quarters and overtimes", () => {
    assert.deepEqual([1, 4, 5, 6].map(periodLabel), ["Q1", "Q4", "OT1", "OT2"]);
  });
});

describe("currentSeason", () => {
  it("is this year's season from October on", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 9, 1) });

    assert.equal(currentSeason(), 2026);
  });

  it("is last year's season before October", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 8, 30) });

    assert.equal(currentSeason(), 2025);
  });
});
