import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ConfigSource } from "../shared/dispatch";

const execFileAsync = promisify(execFile);

export const gitCacheRoot = path.join(homedir(), ".paseo", "plugin-data", "tickets-dispatcher", "git");

type Source = Pick<ConfigSource, "url" | "ref" | "path">;

/** Runs `git <args>`; rejects with a short message. Injectable for tests. */
export type GitRunner = (args: string[]) => Promise<string | void>;

/** Drops any user:password@ part from URLs in a message. */
export function redactUrl(text: string): string {
  return text.replace(/(\w+:\/\/)[^/@\s]+@/g, "$1");
}

export const runGit: GitRunner = async (args) => {
  try {
    const { stdout } = await execFileAsync("git", args, {
      timeout: 120_000,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ALLOW_PROTOCOL: "file:git:http:https:ssh",
        GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes",
      },
    });
    return stdout;
  } catch (error) {
    const e = error as { stderr?: string; message: string };
    const detail = (e.stderr?.trim() || e.message).split("\n").filter(Boolean).slice(-2).join(" ");
    throw new Error(redactUrl(detail).slice(0, 300));
  }
};

/** A read-only shallow clone of the config repository, refreshed on demand. A failed sync keeps the previous copy. */
export class GitSource {
  private inflight: Promise<void> | null = null;
  lastSync: number | null = null;
  error: string | null = null;

  constructor(
    private readonly root: string = gitCacheRoot,
    private readonly git: GitRunner = runGit,
    private readonly now: () => number = Date.now,
  ) {}

  private dir(source: Source): string {
    return path.join(this.root, createHash("sha256").update(`${source.url}\0${source.ref ?? ""}`).digest("hex").slice(0, 16));
  }

  /** The folder inside the clone that holds dispatch.json. */
  folder(source: Source): string {
    return path.join(this.dir(source), source.path ?? "");
  }

  sync(source: Source): Promise<void> {
    this.inflight ??= this.doSync(source).finally(() => (this.inflight = null));
    return this.inflight;
  }

  private async doSync(source: Source): Promise<void> {
    const dir = this.dir(source);
    try {
      if (source.url.startsWith("-") || source.ref?.startsWith("-")) throw new Error("invalid source");
      await mkdir(this.root, { recursive: true });
      if (existsSync(path.join(dir, ".git"))) {
        await this.git(["-C", dir, "fetch", "--depth", "1", "origin", source.ref || "HEAD"]);
        await this.git(["-C", dir, "reset", "--hard", "FETCH_HEAD"]);
      } else {
        const tmp = `${dir}.tmp`;
        await rm(tmp, { recursive: true, force: true });
        const branch = source.ref ? ["--branch", source.ref] : [];
        await this.git(["clone", "--depth", "1", "--single-branch", ...branch, "--", source.url, tmp]);
        await rm(dir, { recursive: true, force: true });
        await rename(tmp, dir);
      }
      this.lastSync = this.now();
      this.error = null;
    } catch (error) {
      this.error = redactUrl((error as Error).message);
    }
  }
}
