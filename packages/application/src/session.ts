/** The authenticated caller of one request: the user's access token plus an optional client grant token. */
export interface CallerSession {
  readonly accessToken: string;
  readonly clientToken?: string;
}
