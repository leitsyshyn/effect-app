import { Config, Schema } from "effect";

export const AUTH_BASE_PATH = "/api/auth";

export const authConfig = Config.all({
  baseURL: Config.schema(
    Schema.URL.check(
      Schema.makeFilter(({ protocol }) => protocol === "http:" || protocol === "https:", {
        message: "Expected an HTTP or HTTPS URL",
      }),
    ),
    "BETTER_AUTH_URL",
  ),
  secret: Config.schema(
    Schema.Redacted(Schema.NonEmptyString.check(Schema.isPattern(/\S/))),
    "BETTER_AUTH_SECRET",
  ),
  trustedOrigins: Config.Array(Schema.NonEmptyString, "BETTER_AUTH_TRUSTED_ORIGINS").pipe(
    Config.withDefault([]),
  ),
});
