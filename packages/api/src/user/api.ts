import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { User } from "@effect-app/domain/user";
import { AuthMiddleware } from "../auth/middleware";

export const CurrentUserResponse = User.pipe(
  Schema.fieldsAssign({
    image: Schema.OptionFromNullOr(Schema.String),
    createdAt: Schema.DateTimeUtcFromString,
    updatedAt: Schema.DateTimeUtcFromString,
  }),
).annotate({ identifier: "CurrentUserResponse" });

export const UserApi = HttpApiGroup.make("user")
  .add(HttpApiEndpoint.get("me", "/api/me", { success: CurrentUserResponse }))
  .middleware(AuthMiddleware);
