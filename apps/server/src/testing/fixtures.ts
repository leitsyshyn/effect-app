import { DateTime, Option, Redacted } from "effect";
import { Principal, Session, SessionId } from "@effect-app/domain/auth";
import { Email, User, UserId } from "@effect-app/domain/user";

export const makeUser = (id: string, email: string) =>
  User.make({
    id: UserId.make(id),
    name: "John",
    email: Email.make(email),
    emailVerified: true,
    image: Option.none(),
    createdAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
    updatedAt: DateTime.makeUnsafe("2026-01-02T00:00:00.000Z"),
  });

export const makeSession = (id: string, userId: string) =>
  Session.make({
    id: SessionId.make(id),
    userId: UserId.make(userId),
    token: Redacted.make("session-token"),
    expiresAt: DateTime.makeUnsafe("2026-02-01T00:00:00.000Z"),
    ipAddress: Option.none(),
    userAgent: Option.none(),
    createdAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
    updatedAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
  });

export const makePrincipal = (userId: string, email: string) =>
  Principal.make({
    user: makeUser(userId, email),
    session: makeSession(`session-of-${userId}`, userId),
  });
