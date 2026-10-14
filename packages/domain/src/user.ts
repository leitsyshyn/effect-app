import { Schema } from "effect";

export const UserId = Schema.NonEmptyString.pipe(Schema.brand("UserId"));
export type UserId = typeof UserId.Type;

export const Email = Schema.Trimmed.check(Schema.isPattern(/^[^\s@]+@[^\s@]+$/)).pipe(
  Schema.brand("Email"),
);
export type Email = typeof Email.Type;

export const User = Schema.Struct({
  id: UserId,
  name: Schema.String,
  email: Email,
  emailVerified: Schema.Boolean,
  image: Schema.Option(Schema.String),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
});

export interface User extends Schema.Schema.Type<typeof User> {}
