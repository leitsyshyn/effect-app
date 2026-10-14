import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Option, Schema } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { Api } from "@effect-app/api/api";
import { CurrentUserResponse } from "@effect-app/api/user/api";
import type { Principal } from "@effect-app/domain/auth";
import { AuthProvider } from "../../infra/auth/provider";
import { Routes } from "../../routes";
import { makePrincipal } from "../../testing/fixtures";
import { DriveService } from "../drive/service";
import { UserHandlers } from "../user/http";
import { AuthMiddlewareLayer } from "./middleware";
import { AuthenticationError, AuthService } from "./service";

const encodeUser = Schema.encodeSync(CurrentUserResponse);

const anonymous = AuthService.of({ authenticate: () => Effect.succeedNone });

const unusedAuthProvider = AuthProvider.of({
  handler: async () => new Response(null, { status: 404 }),
  getSession: () => Effect.succeedNone,
});

const makeWebHandler = Effect.fn("AuthMiddlewareTest.makeWebHandler")(function* (services: {
  readonly authService?: AuthService["Service"];
}) {
  return yield* Effect.acquireRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(
        Routes.pipe(
          Layer.provide([
            Layer.succeed(AuthService, services.authService ?? anonymous),
            Layer.succeed(AuthProvider, unusedAuthProvider),
            Layer.mock(DriveService, {}),
          ]),
          Layer.provide(HttpServer.layerServices),
        ),
        { disableLogger: true },
      ),
    ),
    (web) => Effect.promise(() => web.dispose()),
  );
});

describe("AuthMiddleware", () => {
  it.effect("rejects an unauthenticated protected request", () =>
    Effect.gen(function* () {
      const web = yield* makeWebHandler({});
      const response = yield* Effect.promise(() =>
        web.handler(new Request("http://localhost/api/me")),
      );

      expect(response.status).toBe(401);
    }),
  );

  it.effect("provides the principal for this request only and forwards original headers", () =>
    Effect.gen(function* () {
      const principal = makePrincipal("user-1", "john@example.com");
      const web = yield* makeWebHandler({
        authService: AuthService.of({
          authenticate: (headers) =>
            Effect.succeed(
              headers.get("cookie") === "__Secure-better-auth.session_token=test; other=value" &&
                headers.get("x-request-id") === "request-1"
                ? Option.some(principal)
                : Option.none(),
            ),
        }),
      });

      const response = yield* Effect.promise(() =>
        web.handler(
          new Request("http://localhost/api/me", {
            headers: {
              cookie: "__Secure-better-auth.session_token=test; other=value",
              "x-request-id": "request-1",
            },
          }),
        ),
      );

      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => response.json())).toEqual(encodeUser(principal.user));

      const anonymousResponse = yield* Effect.promise(() =>
        web.handler(new Request("http://localhost/api/me")),
      );
      expect(anonymousResponse.status).toBe(401);
    }),
  );

  it.effect("returns an empty server error when authentication fails", () =>
    Effect.gen(function* () {
      const web = yield* makeWebHandler({
        authService: AuthService.of({
          authenticate: () =>
            Effect.fail(new AuthenticationError({ cause: new Error("Database unavailable") })),
        }),
      });
      const response = yield* Effect.promise(() =>
        web.handler(new Request("http://localhost/api/me")),
      );

      expect(response.status).toBe(500);
      expect(yield* Effect.promise(() => response.text())).toBe("");
    }),
  );

  it.effect("exposes authentication failures as typed errors to API clients", () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(Api, ["user"]);
      const error = yield* client.user.me().pipe(Effect.flip);

      expect(error._tag).toBe("InternalServerError");
    }).pipe(
      Effect.provide(
        UserHandlers.pipe(
          Layer.provideMerge(AuthMiddlewareLayer),
          Layer.provide(
            Layer.succeed(
              AuthService,
              AuthService.of({
                authenticate: () =>
                  Effect.fail(new AuthenticationError({ cause: new Error("Invalid session") })),
              }),
            ),
          ),
          Layer.provideMerge(HttpServer.layerServices),
        ),
      ),
    ),
  );

  it.effect("isolates principals across concurrent requests", () =>
    Effect.gen(function* () {
      const first = makePrincipal("user-1", "first@example.com");
      const second = makePrincipal("user-2", "second@example.com");
      const firstLookup = yield* Deferred.make<Principal>();
      const firstStarted = yield* Deferred.make<void>();
      const web = yield* makeWebHandler({
        authService: AuthService.of({
          authenticate: Effect.fn("AuthTest.authenticate")(function* (headers: Headers) {
            if (headers.get("cookie") === "session=first") {
              yield* Deferred.succeed(firstStarted, undefined);
              return Option.some(yield* Deferred.await(firstLookup));
            }
            return Option.some(second);
          }),
        }),
      });

      const firstFiber = yield* Effect.promise(() =>
        web.handler(
          new Request("http://localhost/api/me", {
            headers: { cookie: "session=first" },
          }),
        ),
      ).pipe(Effect.forkScoped);
      yield* Deferred.await(firstStarted);

      const secondResponse = yield* Effect.promise(() =>
        web.handler(
          new Request("http://localhost/api/me", {
            headers: { cookie: "session=second" },
          }),
        ),
      );
      yield* Deferred.succeed(firstLookup, first);
      const firstResponse = yield* Fiber.join(firstFiber);

      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(200);
      expect(yield* Effect.promise(() => firstResponse.json())).toEqual(encodeUser(first.user));
      expect(yield* Effect.promise(() => secondResponse.json())).toEqual(encodeUser(second.user));
    }),
  );
});
