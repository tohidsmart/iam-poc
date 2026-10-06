// Prints an argon2id hash for config/users.yml.
// Usage: npx tsx scripts/hash-password.ts   (reads the password from stdin)
import { text } from "node:stream/consumers";
import { Argon2Hasher } from "../src/adapters/argon2-hasher.js";

const password = (await text(process.stdin)).replace(/\r?\n$/, "");
if (password.length === 0) {
  console.error("no password on stdin");
  process.exit(1);
}
console.log(await new Argon2Hasher().hash(password));
