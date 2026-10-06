import { describe, expect, it } from "vitest";
import { Argon2Hasher } from "../src/adapters/argon2-hasher.js";

describe("Argon2Hasher", () => {
  const hasher = new Argon2Hasher();

  it("produces a salted argon2id hash that verifies only the right password", async () => {
    const first = await hasher.hash("s3cret");
    const second = await hasher.hash("s3cret");

    expect(first).toMatch(/^\$argon2id\$/);
    expect(first).not.toBe(second);
    expect(await hasher.verify(first, "s3cret")).toBe(true);
    expect(await hasher.verify(first, "S3cret")).toBe(false);
  });

  it("returns false for a malformed hash and does not throw", async () => {
    expect(await hasher.verify("not-a-hash", "s3cret")).toBe(false);
  });
});
