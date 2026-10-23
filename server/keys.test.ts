import { statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { KeyStore } from "./keys";
import { tmp } from "./testing";

describe("KeyStore", () => {
  it("stores keys mode 0600 per workspace, case-insensitively", () => {
    const file = path.join(tmp(), "keys.json");
    const keys = new KeyStore(file);
    keys.set("linear", "Acme", "  lin_api_x ", "acme");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(keys.names()).toEqual(["acme"]);
    expect(keys.get("ACME")).toBe("lin_api_x");
    expect(keys.scope("acme")).toBe("acme");
  });

  it("clears a key", () => {
    const keys = new KeyStore(path.join(tmp(), "keys.json"));
    keys.set("linear", "a", "k");
    keys.clear("a");
    expect(keys.get("a")).toBeNull();
  });

  it.each([["", "k"], ["a", ""], ["a", "has space"], ["bad name!", "k"]])("rejects %j / %j", (name, key) => {
    expect(() => new KeyStore(path.join(tmp(), "keys.json")).set("linear", name, key)).toThrow();
  });

  it("remembers the backend of each connection and lists by backend", () => {
    const keys = new KeyStore(path.join(tmp(), "keys.json"));
    keys.set("linear", "a", "k");
    expect(keys.backend("a")).toBe("linear");
    expect(keys.backend("missing")).toBeNull();
    expect(keys.names("linear")).toEqual(["a"]);
    expect(keys.names("other" as never)).toEqual([]);
  });

  it("treats a file written before backends were per connection as Linear", () => {
    const file = path.join(tmp(), "keys.json");
    writeFileSync(file, JSON.stringify({ old: { key: "k", scope: "acme" } }));
    const keys = new KeyStore(file);
    expect(keys.backend("old")).toBe("linear");
    expect(keys.names("linear")).toEqual(["old"]);
  });

  it("will not reuse a name for another backend", () => {
    const keys = new KeyStore(path.join(tmp(), "keys.json"));
    keys.set("linear", "a", "k");
    expect(() => keys.set("jira" as never, "a", "k2")).toThrow(/another backend/);
    keys.set("linear", "a", "k2");
    expect(keys.get("a")).toBe("k2");
  });
});
