import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { loadPref, savePref } from "../../public/lib/prefs.js";

// A stand-in for the browser's localStorage, or one that refuses access
// like a private window's.
function memoryStorage() {
  const items = new Map();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value)),
    items,
  };
}

const blockedStorage = {
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("SecurityError");
  },
};

describe("prefs", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  function useStorage(storage) {
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  }

  beforeEach(() => {
    useStorage(memoryStorage());
  });

  afterEach(() => {
    if (original) {
      Object.defineProperty(globalThis, "localStorage", original);
    } else {
      delete globalThis.localStorage;
    }
  });

  it("saves values as JSON and reads them back", () => {
    savePref("sorts", { away: { key: "pts", dir: "desc" } });
    savePref("zones", true);
    savePref("speed", 0.5);

    assert.deepEqual(loadPref("sorts", {}), { away: { key: "pts", dir: "desc" } });
    assert.equal(loadPref("zones", false), true);
    assert.equal(loadPref("speed", 1), 0.5);
    assert.equal(globalThis.localStorage.items.get("zones"), "true");
  });

  it("falls back to the default when nothing is saved", () => {
    assert.equal(loadPref("courtTrend", true), true);
  });

  it("falls back to the default for a value that isn't JSON", () => {
    globalThis.localStorage.setItem("speed", "fast");

    assert.equal(loadPref("speed", 1), 1);
  });

  it("falls back to the default, and saves nothing, without storage", () => {
    useStorage(blockedStorage);

    assert.doesNotThrow(() => savePref("zones", true));
    assert.equal(loadPref("zones", false), false);
  });
});
