import { Config, Schema } from "effect";

export const databaseConfig = Config.all({
  url: Config.schema(Schema.Redacted(Schema.NonEmptyString), "DATABASE_URL"),
});
