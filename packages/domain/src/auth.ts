import { Schema } from "effect";
import { User, UserId } from "./user";

export const SessionId = Schema.NonEmptyString.pipe(Schema.brand("SessionId"));
export type SessionId = typeof SessionId.Type;

export const Session = Schema.Struct({
  id: SessionId,
  userId: UserId,
  token: Schema.Redacted(Schema.NonEmptyString, { disallowJsonEncode: true }),
  expiresAt: Schema.DateTimeUtc,
  ipAddress: Schema.Option(Schema.String),
  userAgent: Schema.Option(Schema.String),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
});

export interface Session extends Schema.Schema.Type<typeof Session> {}

export const AccountId = Schema.NonEmptyString.pipe(Schema.brand("AccountId"));
export type AccountId = typeof AccountId.Type;

const Secret = Schema.Redacted(Schema.String, { disallowJsonEncode: true });

export const Account = Schema.Struct({
  id: AccountId,
  userId: UserId,
  provider: Schema.NonEmptyString,
  providerAccountId: Schema.NonEmptyString,
  accessToken: Schema.Option(Secret),
  accessTokenExpiresAt: Schema.Option(Schema.DateTimeUtc),
  refreshToken: Schema.Option(Secret),
  refreshTokenExpiresAt: Schema.Option(Schema.DateTimeUtc),
  idToken: Schema.Option(Secret),
  scope: Schema.Option(Schema.String),
  passwordHash: Schema.Option(Secret),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
});

export interface Account extends Schema.Schema.Type<typeof Account> {}

export const VerificationTokenId = Schema.NonEmptyString.pipe(Schema.brand("VerificationTokenId"));
export type VerificationTokenId = typeof VerificationTokenId.Type;

export const VerificationToken = Schema.Struct({
  id: VerificationTokenId,
  identifier: Schema.NonEmptyString,
  token: Schema.Redacted(Schema.NonEmptyString, { disallowJsonEncode: true }),
  expiresAt: Schema.DateTimeUtc,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
});

export interface VerificationToken extends Schema.Schema.Type<typeof VerificationToken> {}

export const Principal = Schema.Struct({
  user: User,
  session: Session,
});

export interface Principal extends Schema.Schema.Type<typeof Principal> {}
