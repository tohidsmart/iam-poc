/** What the API needs to know about a presented access token. */
export interface TokenInfo {
  readonly subject: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
}

export class IntrospectionUnavailableError extends Error {
  override readonly name = "IntrospectionUnavailableError";
}

export interface TokenIntrospector {
  /**
   * Resolves undefined for a token that is unknown, expired or revoked.
   * @throws IntrospectionUnavailableError when the answer could not be obtained.
   */
  introspect(token: string): Promise<TokenInfo | undefined>;
}
