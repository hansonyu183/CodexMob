import { describe, expect, it } from "vitest";

import { normalizeLocalAbsolutePath } from "@/lib/local/open";

describe("normalizeLocalAbsolutePath", () => {
  it("accepts windows absolute path", () => {
    const value = normalizeLocalAbsolutePath("D:\\code\\skills-dev\\README.md");
    expect(value).toBeTruthy();
  });

  it("accepts windows absolute path with slash style", () => {
    const value = normalizeLocalAbsolutePath("D:/code/skills-dev/README.md");
    expect(value).toBe("D:\\code\\skills-dev\\README.md");
  });

  it("accepts drive path missing slash and normalizes", () => {
    const value = normalizeLocalAbsolutePath("D:code\\skills-dev\\README.md");
    expect(value).toBe("D:\\code\\skills-dev\\README.md");
  });

  it("accepts unc path", () => {
    const value = normalizeLocalAbsolutePath("\\\\wsl$\\Ubuntu\\home\\user\\a.txt");
    expect(value).toBeTruthy();
  });

  it("rejects http and file url", () => {
    expect(normalizeLocalAbsolutePath("https://a.com/x")).toBeNull();
    expect(normalizeLocalAbsolutePath("file:///D:/code/a.txt")).toBeNull();
  });

  it("rejects relative path", () => {
    expect(normalizeLocalAbsolutePath(".\\a.txt")).toBeNull();
  });

  it("rejects bare drive path", () => {
    expect(normalizeLocalAbsolutePath("D:")).toBeNull();
  });
});
