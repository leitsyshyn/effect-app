import { BunCrypto } from "@effect/platform-bun";
import { Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import type { Principal } from "@effect-app/domain/auth";
import { DriveEvents } from "../features/drive/events";
import { DriveService } from "../features/drive/service";
import { AuthService } from "../features/auth/service";
import { AuthProvider } from "../infra/auth/provider";
import { BlobStore } from "../infra/storage/blob-store";
import { Routes } from "../routes";
import { memoryDriveRepositoryLayer } from "./drive-repository";
import { makePrincipal } from "./fixtures";

export interface TestAccount {
  readonly token: string;
  readonly principal: Principal;
}

export const testAccount: TestAccount = {
  token: "test-token",
  principal: makePrincipal("user-test", "tester@example.com"),
};

export const makeInProcessServer = Effect.fn("InProcessServer.make")(function* (
  accounts: ReadonlyArray<TestAccount> = [testAccount],
) {
  const byAuthorization = new Map(
    accounts.map((account) => [`Bearer ${account.token}`, account.principal]),
  );
  const auth = AuthService.of({
    authenticate: (headers) =>
      Effect.succeed(
        Option.fromUndefinedOr(byAuthorization.get(headers.get("authorization") ?? "")),
      ),
  });
  const drive = DriveService.layerWithoutDependencies.pipe(
    Layer.provide(
      memoryDriveRepositoryLayer(
        Object.fromEntries(
          accounts.map((account) => [account.principal.user.id, account.principal.user.name]),
        ),
      ),
    ),
    Layer.provide([DriveEvents.layer, BlobStore.layerMemory, BunCrypto.layer]),
  );

  const web = yield* Effect.acquireRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(
        Routes.pipe(
          Layer.provide([
            Layer.succeed(AuthService, auth),
            Layer.mock(AuthProvider, { handler: async () => new Response(null, { status: 404 }) }),
            drive,
          ]),
          Layer.provide(HttpServer.layerServices),
        ),
        { disableLogger: true },
      ),
    ),
    (handler) => Effect.promise(() => handler.dispose()),
  );

  const serve = (input: string | URL | Request, init?: RequestInit) =>
    web.handler(input instanceof Request ? input : new Request(String(input), init));

  return {
    fetch: Object.assign(serve, {
      preconnect: globalThis.fetch.preconnect,
    }) satisfies typeof globalThis.fetch,
  };
});
