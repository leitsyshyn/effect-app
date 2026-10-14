import { BunHttpServer } from "@effect/platform-bun";
import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api";
import { ControlApi } from "./api";
import { controlAuthLayer } from "./auth";
import { LinkHandlers, SessionHandlers, StatusHandlers, SyncHandlers } from "./http";

export const controlServerLayer = (options: { readonly port: number; readonly token: string }) =>
  HttpRouter.serve(
    Layer.mergeAll(
      HttpApiBuilder.layer(ControlApi, { openapiPath: "/openapi.json" }).pipe(
        Layer.provide([StatusHandlers, SessionHandlers, LinkHandlers, SyncHandlers]),
        Layer.provide(controlAuthLayer(options.token)),
      ),
      HttpApiScalar.layer(ControlApi, { path: "/docs" }),
    ),
  ).pipe(Layer.provide(BunHttpServer.layer({ hostname: "127.0.0.1", port: options.port })));
