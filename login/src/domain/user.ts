export interface User {
  /** Stable identifier, sent to Hydra as the OAuth2 subject. Never the username, which can change. */
  readonly id: string;
  readonly username: string;
  readonly passwordHash: string;
  readonly name: string;
  readonly email: string;
}

/** Usernames compare case-insensitively and ignore surrounding whitespace. */
export const normaliseUsername = (username: string): string => username.trim().toLowerCase();
