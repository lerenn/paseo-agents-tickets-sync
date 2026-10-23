import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { migrateLegacyData } from "./files";
import { tmp } from "./testing";

const dirs = (home: string) => ({
  legacy: path.join(home, ".paseo", "plugin-data", "agents-tickets-sync"),
  current: path.join(home, ".paseo", "plugin-data", "tickets-dispatcher"),
});

describe("migrateLegacyData", () => {
  it("moves the old data directory once, keeping its files", () => {
    const home = tmp();
    const { legacy, current } = dirs(home);
    mkdirSync(legacy, { recursive: true });
    writeFileSync(path.join(legacy, "keys.json"), '{"a":{"key":"k"}}');
    expect(migrateLegacyData(home)).toBe(true);
    expect(existsSync(legacy)).toBe(false);
    expect(readFileSync(path.join(current, "keys.json"), "utf8")).toBe('{"a":{"key":"k"}}');
    expect(migrateLegacyData(home)).toBe(false);
  });

  it("never overwrites data already in the new directory", () => {
    const home = tmp();
    const { legacy, current } = dirs(home);
    mkdirSync(legacy, { recursive: true });
    mkdirSync(current, { recursive: true });
    writeFileSync(path.join(current, "keys.json"), "new");
    expect(migrateLegacyData(home)).toBe(false);
    expect(readFileSync(path.join(current, "keys.json"), "utf8")).toBe("new");
    expect(existsSync(legacy)).toBe(true);
  });

  it("does nothing on a fresh install", () => {
    expect(migrateLegacyData(tmp())).toBe(false);
  });
});
