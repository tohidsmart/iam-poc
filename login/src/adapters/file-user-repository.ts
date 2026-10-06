import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { normaliseUsername, type User } from "../domain/user.js";
import type { UserRepository } from "../ports/user-repository.js";

const fileSchema = z.object({
  users: z
    .array(
      z.object({
        id: z.string().min(1),
        username: z.string().min(1),
        // Refuse anything that is not an argon2id hash, so a plaintext or
        // weakly hashed password can never be loaded by mistake.
        passwordHash: z.string().startsWith("$argon2id$", "must be an argon2id hash"),
        name: z.string().min(1),
        email: z.string().email(),
      }),
    )
    .min(1),
});

export class UserFileError extends Error {
  override readonly name = "UserFileError";
}

/** Seeded users, read once at start-up. Immutable afterwards, so replicas never disagree. */
export class FileUserRepository implements UserRepository {
  private readonly byId: ReadonlyMap<string, User>;

  private constructor(private readonly byUsername: ReadonlyMap<string, User>) {
    this.byId = new Map([...byUsername.values()].map((user) => [user.id, user]));
  }

  static fromFile(path: string): FileUserRepository {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      throw new UserFileError(`users file: cannot read ${path}`);
    }
    return FileUserRepository.fromYaml(text);
  }

  static fromYaml(text: string): FileUserRepository {
    let raw: unknown;
    try {
      raw = parse(text);
    } catch {
      throw new UserFileError("users file: not valid YAML");
    }
    const parsed = fileSchema.safeParse(raw);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
      throw new UserFileError(`users file: ${problems.join("; ")}`);
    }

    const byUsername = new Map<string, User>();
    const ids = new Set<string>();
    for (const entry of parsed.data.users) {
      const user: User = { ...entry, username: normaliseUsername(entry.username) };
      if (byUsername.has(user.username)) throw new UserFileError(`users file: duplicate username ${user.username}`);
      if (ids.has(user.id)) throw new UserFileError(`users file: duplicate id ${user.id}`);
      byUsername.set(user.username, user);
      ids.add(user.id);
    }
    return new FileUserRepository(byUsername);
  }

  async findByUsername(username: string): Promise<User | undefined> {
    return this.byUsername.get(username);
  }

  async findById(id: string): Promise<User | undefined> {
    return this.byId.get(id);
  }
}
