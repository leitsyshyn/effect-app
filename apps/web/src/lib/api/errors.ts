import { HttpClientError } from "effect/http";
import { HttpApiError } from "effect/http-api";

export const responseStatus = (error: unknown): number | undefined =>
  HttpClientError.isHttpClientError(error) ? error.response?.status : undefined;

export const isUnauthorized = (error: unknown): boolean =>
  error instanceof HttpApiError.Unauthorized || responseStatus(error) === 401;
