/** What this service needs from Hydra's admin API. Grows with each flow. */
export interface HydraAdminClient {
  /** Resolves true when the admin API is reachable and reports ready. Never rejects. */
  isReady(): Promise<boolean>;
}
