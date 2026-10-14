import { Schema } from "effect";
import { HttpClientError } from "effect/http";
import {
  InvalidMove,
  InvalidUpload,
  NameConflict,
  NodeNotFound,
  NotAFile,
  ParentNotFolder,
  RevisionMismatch,
} from "@effect-app/domain/drive";
import { isUnauthorized } from "@/lib/api/errors";
import { formatBytes } from "./format";

export class InvalidName extends Schema.TaggedError<InvalidName>()("InvalidName", {
  reason: Schema.String,
}) {}

export class FileTooLarge extends Schema.TaggedError<FileTooLarge>()("FileTooLarge", {
  name: Schema.String,
  limit: Schema.Number,
}) {}

export class ContentUnavailable extends Schema.TaggedError<ContentUnavailable>()(
  "ContentUnavailable",
  { status: Schema.Number },
) {}

export const isNameConflict = (error: unknown): error is NameConflict =>
  error instanceof NameConflict;

export const isRevisionMismatch = (error: unknown): error is RevisionMismatch =>
  error instanceof RevisionMismatch;

export const isStaleNodeError = (error: unknown): boolean =>
  error instanceof RevisionMismatch || error instanceof NodeNotFound;

export const describeDriveError = (error: unknown): string => {
  if (error instanceof NameConflict) {
    return `“${error.name}” already exists here`;
  }
  if (error instanceof RevisionMismatch) {
    return "Changed elsewhere in the meantime. Try again";
  }
  if (error instanceof NodeNotFound) {
    return "This item no longer exists";
  }
  if (error instanceof ParentNotFolder) return "The destination isn't a folder";
  if (error instanceof InvalidMove) return `Can't move here: ${error.reason}`;
  if (error instanceof NotAFile) return "A folder with this name is in the way";
  if (error instanceof InvalidUpload) return `Upload rejected: ${error.reason}`;
  if (error instanceof InvalidName) return error.reason;
  if (error instanceof FileTooLarge) {
    return `“${error.name}” is over the ${formatBytes(error.limit)} upload limit`;
  }
  if (error instanceof ContentUnavailable) {
    return `Couldn't load the file (HTTP ${error.status})`;
  }
  if (isUnauthorized(error)) return "Session ended. Sign in again";
  if (HttpClientError.isHttpClientError(error)) {
    const status = error.response?.status;
    if (status === undefined) {
      return "Couldn't reach the server";
    }
    if (status >= 500) return "Server error. Try again";
    return `Request refused (HTTP ${status})`;
  }
  if (Schema.isSchemaError(error)) return "Unexpected response from the server";
  return "Something went wrong. Try again";
};

export const shouldRetry = (failureCount: number, error: unknown): boolean => {
  if (failureCount >= 2) return false;
  if (!HttpClientError.isHttpClientError(error)) return false;
  const status = error.response?.status;
  return status === undefined || status >= 500;
};
