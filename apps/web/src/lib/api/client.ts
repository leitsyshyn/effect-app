import { Api } from "@effect-app/api/api";
import { Context, Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";

export class ApiClient extends Context.Service<ApiClient, HttpApiClient.ForApi<typeof Api>>()(
  "effect-app/web/ApiClient",
) {
  static readonly layer = Layer.effect(ApiClient, HttpApiClient.make(Api)).pipe(
    Layer.provide(FetchHttpClient.layer),
  );
}

export const apiRuntime = ManagedRuntime.make(ApiClient.layer);

export const apiUrls = HttpApiClient.urlBuilder(Api);
