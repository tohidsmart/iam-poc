export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /** Resolves false for a wrong password or an unusable hash. Never rejects. */
  verify(hash: string, password: string): Promise<boolean>;
}
