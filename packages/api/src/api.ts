import { HttpApi, OpenApi } from "effect/http-api";
import { DriveApi, HealthApi } from "./drive/api";
import { UserApi } from "./user/api";

const PUBLIC_PATHS = new Set(["/api/health"]);

const addSecuritySchemes = (spec: Record<string, any>): Record<string, any> => {
  if (spec["paths"] === undefined) return spec;
  const paths: Record<string, Record<string, any>> = spec["paths"];
  for (const [path, operations] of Object.entries(paths)) {
    if (PUBLIC_PATHS.has(path)) continue;
    for (const operation of Object.values(operations)) {
      operation["security"] = [{ bearerAuth: [] }, { cookieAuth: [] }];
    }
  }
  return {
    ...spec,
    components: {
      ...spec["components"],
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
        cookieAuth: { type: "apiKey", in: "cookie", name: "better-auth.session_token" },
      },
    },
  };
};

export const Api = HttpApi.make("effect-app")
  .add(UserApi)
  .add(DriveApi)
  .add(HealthApi)
  .annotateMerge(
    OpenApi.annotations({
      title: "Effect Drive API",
      version: "1.0.0",
      transform: addSecuritySchemes,
    }),
  );
