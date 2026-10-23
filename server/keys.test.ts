import { statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { KeyStore } from "./keys";
import { tmp } from "./testing";

describe("KeyStore", () => {
  it("stores keys mode 0600 per workspace, case-insensitively", () => {
    const file = path.join(tmp(), "keys.json");
    const keys = new KeyStore(file);
    keys.set("Acme", "  lin_api_x ", "acme");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(keys.names()).toEqual(["acme"]);
    expect(keys.get("ACME")).toBe("lin_api_x");
    expect(keys.scope("acme")).toBe("acme");
  });

  it("clears a key", () => {
    const keys = new KeyStore(path.join(tmp(), "keys.json"));
    keys.set("a", "k");
    keys.clear("a");
    expect(keys.get("a")).toBeNull();
  });

  it.each([["", "k"], ["a", ""], ["a", "has space"], ["bad name!", "k"]])("rejects %j / %j", (name, key) => {
    expect(() => new KeyStore(path.join(tmp(), "keys.json")).set(name, key)).toThrow();
  });
});
