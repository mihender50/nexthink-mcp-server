import type { AuthProvider } from "./types.js";
import type { NexthinkConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { OAuthClientCredentialsProvider } from "./oauthProvider.js";
import { BearerAuthProvider, BasicAuthProvider } from "./staticProviders.js";

/** Builds the concrete {@link AuthProvider} selected by config. */
export function createAuthProvider(
  config: NexthinkConfig,
  logger: Logger
): AuthProvider {
  switch (config.auth.type) {
    case "oauth2_basic":
    case "oauth2_post":
      return new OAuthClientCredentialsProvider(
        config.auth,
        config.httpTimeoutMs,
        logger
      );
    case "bearer":
      return new BearerAuthProvider(config.auth);
    case "basic":
      return new BasicAuthProvider(config.auth);
  }
}
