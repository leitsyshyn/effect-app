import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { AuthProvider } from "../../infra/auth/provider";
import { AuthRoutes } from "./http";

const unusedAuthProvider = AuthProvider.of({
  handler: async () => new Response(null, { status: 404 }),
  getSession: () => Effect.succeedNone,
});

const makeWebHandler = Effect.fn("AuthRoutesTest.makeWebHandler")(function* (services: {
  readonly authProvider: AuthProvider["Service"];
}) {
  return yield* Effect.acquireRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(
        AuthRoutes.pipe(
          Layer.provide(Layer.succeed(AuthProvider, services.authProvider)),
          Layer.provide(HttpServer.layerServices),
        ),
        { disableLogger: true },
      ),
    ),
    (web) => Effect.promise(() => web.dispose()),
  );
});

describe("AuthRoutes", () => {
  it.effect("returns a server error when the provider handler fails", () =>
    Effect.gen(function* () {
      const web = yield* makeWebHandler({
        authProvider: AuthProvider.of({
          ...unusedAuthProvider,
          handler: () => Promise.reject(new Error("Auth unavailable")),
        }),
      });
      const response = yield* Effect.promise(() =>
        web.handler(new Request("http://localhost/api/auth/get-session")),
      );

      expect(response.status).toBe(500);
    }),
  );

  it.effect("bridges provider requests and preserves response cookies", () =>
    Effect.gen(function* () {
      const web = yield* makeWebHandler({
        authProvider: AuthProvider.of({
          ...unusedAuthProvider,
          handler: async (request) => {
            const headers = new Headers({ "content-type": "application/json" });
            headers.append("set-cookie", "session=one; Path=/; HttpOnly");
            headers.append("set-cookie", "other=two; Path=/; HttpOnly");
            return new Response(
              JSON.stringify({
                path: new URL(request.url).pathname,
                method: request.method,
                contentType: request.headers.get("content-type"),
                body: await request.json(),
              }),
              { status: 201, headers },
            );
          },
        }),
      });
      const response = yield* Effect.promise(() =>
        web.handler(
          new Request("http://localhost/api/auth/sign-up/email", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: '{"email":"john@example.com"}',
          }),
        ),
      );

      expect(response.status).toBe(201);
      expect(yield* Effect.promise(() => response.json())).toEqual({
        path: "/api/auth/sign-up/email",
        method: "POST",
        contentType: "application/json",
        body: { email: "john@example.com" },
      });
      expect(response.headers.getSetCookie()).toEqual([
        "session=one; Path=/; HttpOnly",
        "other=two; Path=/; HttpOnly",
      ]);
    }),
  );
});
