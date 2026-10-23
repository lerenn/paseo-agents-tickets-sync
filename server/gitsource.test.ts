import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GitSource, redactUrl } from "./gitsource";
import { tmp } from "./testing";

describe("GitSource", () => {
  it("clones into a cache folder and points at the configured path", async () => {
    const calls: string[][] = [];
    const root = tmp();
    const git = new GitSource(root, async (args) => {
      calls.push(args);
      if (args[0] === "clone") {
        const dest = args[args.length - 1];
        mkdirSync(path.join(dest, "services", "cfg"), { recursive: true });
        writeFileSync(path.join(dest, ".git"), "");
      }
    }, () => 42);
    const source = { url: "git@github.com:acme/lab.git", ref: "main", path: "services/cfg" };
    await git.sync(source);
    expect(calls[0].slice(0, 6)).toEqual(["clone", "--depth", "1", "--single-branch", "--branch", "main"]);
    expect(git.lastSync).toBe(42);
    expect(git.folder(source)).toMatch(/services\/cfg$/);
    await git.sync(source);
    expect(calls[1].slice(0, 3)).toEqual(["-C", expect.any(String), "fetch"]);
  });

  it("records an error without credentials and keeps going", async () => {
    const git = new GitSource(tmp(), async () => {
      throw new Error("fatal: could not read from https://user:secret@github.com/acme/lab.git");
    });
    await git.sync({ url: "https://github.com/acme/lab.git" });
    expect(git.error).toBe("fatal: could not read from https://github.com/acme/lab.git");
    expect(git.lastSync).toBeNull();
  });

  it("refuses options that look like flags", async () => {
    const git = new GitSource(tmp(), async () => undefined);
    await git.sync({ url: "--upload-pack=x" });
    expect(git.error).toBe("invalid source");
  });

  it("redacts credentials in URLs", () => {
    expect(redactUrl("x https://a:b@h/r y")).toBe("x https://h/r y");
  });
});
