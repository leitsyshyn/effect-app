import { Layer } from "effect";
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api";
import { Api } from "@effect-app/api/api";
import { AuthRoutes } from "./features/auth/http";
import { AuthMiddlewareLayer } from "./features/auth/middleware";
import { DriveHandlers, HealthHandlers } from "./features/drive/http";
import { UserHandlers } from "./features/user/http";

const ApiRoutes = HttpApiBuilder.layer(Api, { openapiPath: "/api/openapi.json" }).pipe(
  Layer.provide(UserHandlers),
  Layer.provide(DriveHandlers),
  Layer.provide(HealthHandlers),
  Layer.provide(AuthMiddlewareLayer),
);

const DocsRoutes = HttpApiScalar.layer(Api, { path: "/api/docs" });

export const Routes = Layer.mergeAll(ApiRoutes, AuthRoutes, DocsRoutes);
