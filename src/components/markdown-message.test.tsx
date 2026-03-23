import { describe, expect, it } from "vitest";

import {
  getMessagePlainText,
  normalizeLocalPathCandidateForTests,
} from "@/components/markdown-message";

describe("getMessagePlainText", () => {
  it("normalizes line breaks and trims surrounding spaces", () => {
    const input = "  hello\r\nworld  \n";
    expect(getMessagePlainText(input)).toBe("hello\nworld");
  });

  it("recognizes local path variants", () => {
    expect(normalizeLocalPathCandidateForTests("D:\\code\\a.txt")).toBe("D:\\code\\a.txt");
    expect(normalizeLocalPathCandidateForTests("D:/code/a.txt")).toBe("D:\\code\\a.txt");
    expect(normalizeLocalPathCandidateForTests("D:code\\a.txt")).toBe("D:\\code\\a.txt");
    expect(normalizeLocalPathCandidateForTests("file:///D:/code/a.txt")).toBe("D:\\code\\a.txt");
  });

  it("rejects non-local links", () => {
    expect(normalizeLocalPathCandidateForTests("https://example.com")).toBeNull();
    expect(normalizeLocalPathCandidateForTests("./a.txt")).toBeNull();
  });
});
