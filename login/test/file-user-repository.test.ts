import { describe, expect, it } from "vitest";
import { FileUserRepository, UserFileError } from "../src/adapters/file-user-repository.js";

const user = (overrides: Record<string, string> = {}) => ({
  id: "id-1",
  username: "Alice",
  passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA",
  name: "Alice Example",
  email: "alice@example.com",
  ...overrides,
});
const yaml = (...users: object[]) => JSON.stringify({ users }); // JSON is valid YAML

describe("FileUserRepository", () => {
  it("finds a user by normalised username", async () => {
    const repository = FileUserRepository.fromYaml(yaml(user()));

    expect(await repository.findByUsername("alice")).toMatchObject({ id: "id-1", username: "alice" });
    expect(await repository.findByUsername("bob")).toBeUndefined();
  });

  it("refuses a password that is not an argon2id hash", () => {
    expect(() => FileUserRepository.fromYaml(yaml(user({ passwordHash: "plaintext" })))).toThrowError(
      /users\.0\.passwordHash: must be an argon2id hash/,
    );
  });

  it("refuses duplicate usernames, ignoring case", () => {
    expect(() => FileUserRepository.fromYaml(yaml(user(), user({ id: "id-2", username: "ALICE" })))).toThrowError(
      new UserFileError("users file: duplicate username alice"),
    );
  });

  it("refuses duplicate ids", () => {
    expect(() => FileUserRepository.fromYaml(yaml(user(), user({ username: "bob" })))).toThrowError(/duplicate id id-1/);
  });

  it("refuses an empty or malformed file", () => {
    expect(() => FileUserRepository.fromYaml("users: []")).toThrowError(UserFileError);
    expect(() => FileUserRepository.fromYaml("users: [")).toThrowError(new UserFileError("users file: not valid YAML"));
  });

  it("loads the seeded users shipped with the service", async () => {
    const repository = FileUserRepository.fromFile("config/users.yml");

    expect(await repository.findByUsername("alice")).toBeDefined();
  });
});
