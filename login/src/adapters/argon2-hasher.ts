import argon2 from "argon2";
import type { PasswordHasher } from "../ports/password-hasher.js";

/** argon2id with the library defaults, which meet the OWASP minimums. */
export class Argon2Hasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}
