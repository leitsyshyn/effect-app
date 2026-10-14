import { BunHttpServer } from "@effect/platform-bun";
import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { serverConfig } from "./config";
import { AuthService } from "./features/auth/service";
import { DriveService } from "./features/drive/service";
import { AuthProvider } from "./infra/auth/provider";
import { Routes } from "./routes";

export const ServerLayer = HttpRouter.serve(Routes).pipe(
  Layer.provide(DriveService.layer),
  Layer.provide(AuthService.layer),
  Layer.provide(AuthProvider.layer),
  Layer.provide(BunHttpServer.layerConfig(serverConfig)),
);
