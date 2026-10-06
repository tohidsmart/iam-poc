import type { User } from "../domain/user.js";

export interface UserRepository {
  /** Looks a user up by exact, already-normalised username. */
  findByUsername(username: string): Promise<User | undefined>;
  findById(id: string): Promise<User | undefined>;
}
