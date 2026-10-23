import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigService, readConfig } from "./config";
import { tmp } from "./testing";

function folder(content: string | null) {
  const dir = tmp();
  if (content !== null) writeFileSync(path.join(dir, "dispatch.json"), content);
  return dir;
}

describe("readConfig", () => {
  it("reads teams with defaults and upper-cases the keys", () => {
    const r = readConfig(folder(JSON.stringify({ teams: { any: { project: "Monorepo" }, DVRL: { project: "prj_x", label: "growth", states: ["backlog"], provider: "codex", roles: { bug: "fixer" } } } })));
    expect(r).toMatchObject({ config: { provider: "claude" } });
    const teams = (r as any).config.teams;
    expect(Object.keys(teams)).toEqual(["ANY", "DVRL"]);
    expect(teams.ANY).toEqual({ project: "Monorepo", states: ["unstarted"], roles: {} });
    expect(teams.DVRL).toMatchObject({ label: "growth", states: ["backlog"], provider: "codex", roles: { bug: "fixer" } });
  });

  it("explains a missing file, bad JSON and a bad shape", () => {
    expect(readConfig(folder(null))).toEqual({ error: expect.stringMatching(/not found/) });
    expect(readConfig(folder("{nope"))).toEqual({ error: expect.stringMatching(/not valid JSON/) });
    expect(readConfig(folder(JSON.stringify({ teams: { ANY: {} } })))).toEqual({ error: expect.stringMatching(/dispatch\.json: .*project/s) });
    expect(readConfig(folder(JSON.stringify({ teams: { "1bad": { project: "p" } } })))).toEqual({ error: expect.stringMatching(/teams/) });
  });

  it("rejects an unknown state type", () => {
    expect(readConfig(folder(JSON.stringify({ teams: { ANY: { project: "p", states: ["done"] } } })))).toEqual({ error: expect.any(String) });
  });
});

describe("ConfigService", () => {
  it("keeps the last good config when a later read fails", () => {
    const svc = new ConfigService(() => 7);
    expect(svc.loaded).toBe(false);
    svc.load(folder(JSON.stringify({ teams: { ANY: { project: "p" } } })));
    expect(svc.loaded).toBe(true);
    expect(svc.syncedAt).toBe(7);
    svc.load(folder("{broken"));
    expect(svc.state.error).toMatch(/not valid JSON/);
    expect(Object.keys(svc.state.config.teams)).toEqual(["ANY"]);
    svc.fail("Config source: network");
    expect(svc.state.error).toBe("Config source: network");
  });
});
