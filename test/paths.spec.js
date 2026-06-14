import { describe, it, expect } from "vitest";
import {
  splitPath, vaultName, vaultRelative, buildObsidianUri,
  obsidianConfigPath, parseObsidianVaults,
} from "../src/paths.js";

describe("splitPath", () => {
  it("splits POSIX and Windows paths the same way", () => {
    expect(splitPath("/Users/me/Vault/Notes")).toEqual(["Users", "me", "Vault", "Notes"]);
    expect(splitPath("C:\\Users\\me\\Vault\\Notes")).toEqual(["C:", "Users", "me", "Vault", "Notes"]);
  });
  it("ignores empty segments / trailing slashes", () => {
    expect(splitPath("/a//b/")).toEqual(["a", "b"]);
    expect(splitPath("")).toEqual([]);
  });
});

describe("vaultName", () => {
  it("is the basename on both separators", () => {
    expect(vaultName("/Users/me/Academic Vault")).toBe("Academic Vault");
    expect(vaultName("D:\\Research\\MyVault")).toBe("MyVault");
  });
});

describe("vaultRelative", () => {
  it("computes a forward-slash, extension-less path (POSIX)", () => {
    expect(vaultRelative("/v/Vault/Library/References/@doe.md", "/v/Vault"))
      .toBe("Library/References/@doe");
  });
  it("computes the same on Windows (backslashes in, slashes out)", () => {
    expect(vaultRelative("C:\\v\\Vault\\Refs\\@doe.md", "C:\\v\\Vault"))
      .toBe("Refs/@doe");
  });
  it("is case-insensitive on the vault prefix", () => {
    expect(vaultRelative("/V/vault/refs/@doe.md", "/v/Vault")).toBe("refs/@doe");
  });
  it("returns null when the note is not under the vault", () => {
    expect(vaultRelative("/somewhere/else/@doe.md", "/v/Vault")).toBeNull();
    expect(vaultRelative("/v/Vault", "/v/Vault")).toBeNull(); // note == vault, no rel
  });
});

describe("buildObsidianUri", () => {
  it("encodes vault + file", () => {
    expect(buildObsidianUri("Academic Vault", "Refs/@doe"))
      .toBe("obsidian://open?vault=Academic%20Vault&file=Refs%2F%40doe");
  });
});

describe("obsidianConfigPath", () => {
  it("macOS", () => {
    expect(obsidianConfigPath("mac", { home: "/Users/me" }))
      .toBe("/Users/me/Library/Application Support/obsidian/obsidian.json");
  });
  it("Windows (APPDATA)", () => {
    expect(obsidianConfigPath("win", { appData: "C:\\Users\\me\\AppData\\Roaming" }))
      .toBe("C:\\Users\\me\\AppData\\Roaming\\obsidian\\obsidian.json");
  });
  it("Windows falls back to home/AppData/Roaming", () => {
    expect(obsidianConfigPath("win", { home: "C:\\Users\\me" }))
      .toBe("C:\\Users\\me\\AppData\\Roaming\\obsidian\\obsidian.json");
  });
  it("Linux (XDG_CONFIG_HOME, then ~/.config)", () => {
    expect(obsidianConfigPath("linux", { xdgConfigHome: "/home/me/.config" }))
      .toBe("/home/me/.config/obsidian/obsidian.json");
    expect(obsidianConfigPath("linux", { home: "/home/me" }))
      .toBe("/home/me/.config/obsidian/obsidian.json");
  });
});

describe("parseObsidianVaults", () => {
  it("extracts vault paths + names", () => {
    const json = JSON.stringify({
      vaults: {
        a1: { path: "/Users/me/Academic Vault", ts: 1, open: true },
        b2: { path: "/Users/me/Scratch" },
      },
    });
    const out = parseObsidianVaults(json);
    expect(out).toEqual([
      { path: "/Users/me/Academic Vault", name: "Academic Vault", open: true },
      { path: "/Users/me/Scratch", name: "Scratch", open: false },
    ]);
  });
  it("tolerates malformed / empty input", () => {
    expect(parseObsidianVaults("not json")).toEqual([]);
    expect(parseObsidianVaults("{}")).toEqual([]);
    expect(parseObsidianVaults(JSON.stringify({ vaults: null }))).toEqual([]);
  });
});
