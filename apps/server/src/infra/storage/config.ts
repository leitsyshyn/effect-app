import { Config, Schema } from "effect";

export const storageConfig = Config.all({
  endpoint: Config.schema(Schema.URL, "S3_ENDPOINT"),
  bucket: Config.schema(Schema.NonEmptyString, "S3_BUCKET"),
  region: Config.schema(Schema.NonEmptyString, "S3_REGION").pipe(Config.withDefault("us-east-1")),
  accessKeyId: Config.schema(Schema.Redacted(Schema.NonEmptyString), "S3_ACCESS_KEY_ID"),
  secretAccessKey: Config.schema(Schema.Redacted(Schema.NonEmptyString), "S3_SECRET_ACCESS_KEY"),
});
