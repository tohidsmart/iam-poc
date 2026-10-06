/** What the token endpoint returns for an authorization code. */
export interface TokenSet {
  readonly accessToken: string;
  readonly idToken: string | undefined;
  readonly refreshToken: string | undefined;
  readonly scope: string;
  readonly expiresIn: number;
}

/** The token endpoint refused the code (expired, reused, wrong verifier) or could not be reached. */
export class TokenExchangeError extends Error {
  override readonly name = "TokenExchangeError";
}

export interface TokenExchanger {
  /** @throws TokenExchangeError */
  exchange(code: string, codeVerifier: string): Promise<TokenSet>;
}
