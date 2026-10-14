import { Effect, Option, Schema } from "effect";
import { HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/http";
import { HttpApiError } from "effect/http-api";
import { describe, expect, it } from "vitest";
import {
  InvalidMove,
  NameConflict,
  NodeId,
  NodeNotFound,
  Revision,
  RevisionMismatch,
} from "@effect-app/domain/drive";
import {
  describeDriveError,
  FileTooLarge,
  InvalidName,
  isStaleNodeError,
  shouldRetry,
} from "./drive-errors";

const id = NodeId.make("4b6f8c1e-2d3a-4f5b-9c7d-1e2f3a4b5c6d");
const request = HttpClientRequest.get("/api/drive/nodes");

const statusError = (status: number) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.StatusCodeError({
      request,
      response: HttpClientResponse.fromWeb(request, new Response(null, { status })),
    }),
  });

const transportError = new HttpClientError.HttpClientError({
  reason: new HttpClientError.TransportError({ request }),
});

describe("describeDriveError", () => {
  it("names the conflicting item", () => {
    const error = new NameConflict({ parentId: Option.none(), name: "notes.txt" });
    expect(describeDriveError(error)).toBe("“notes.txt” already exists here");
  });

  it("explains a revision mismatch as someone else's change", () => {
    const error = new RevisionMismatch({
      id,
      expected: Revision.make(1),
      actual: Revision.make(2),
    });
    expect(describeDriveError(error)).toMatch(/changed elsewhere/i);
  });

  it("passes on the server's reason for an invalid move", () => {
    const error = new InvalidMove({ id, reason: "A folder cannot be moved into itself" });
    expect(describeDriveError(error)).toBe("Can't move here: A folder cannot be moved into itself");
  });

  it("describes client-side validation failures", () => {
    expect(describeDriveError(new InvalidName({ reason: "Name must not be empty" }))).toBe(
      "Name must not be empty",
    );
    expect(
      describeDriveError(new FileTooLarge({ name: "movie.mov", limit: 512 * 1024 * 1024 })),
    ).toBe("“movie.mov” is over the 512 MB upload limit");
  });

  it("treats a 401 as an ended session", () => {
    expect(describeDriveError(new HttpApiError.Unauthorized())).toMatch(/sign in again/i);
    expect(describeDriveError(statusError(401))).toMatch(/sign in again/i);
  });

  it("distinguishes network, server and request failures", () => {
    expect(describeDriveError(transportError)).toMatch(/couldn't reach the server/i);
    expect(describeDriveError(statusError(503))).toMatch(/server error/i);
    expect(describeDriveError(statusError(413))).toBe("Request refused (HTTP 413)");
  });

  it("falls back to a generic message", () => {
    expect(describeDriveError(new Error("boom"))).toBe("Something went wrong. Try again");
    expect(describeDriveError(undefined)).toBe("Something went wrong. Try again");
  });

  it("recognizes undecodable responses", () => {
    const error = Effect.runSync(Effect.flip(Schema.decodeUnknownEffect(Schema.Number)("nope")));
    expect(describeDriveError(error)).toMatch(/unexpected response/i);
  });
});

describe("isStaleNodeError", () => {
  it("flags errors that mean the listing is out of date", () => {
    expect(isStaleNodeError(new NodeNotFound({ id }))).toBe(true);
    expect(
      isStaleNodeError(
        new RevisionMismatch({ id, expected: Revision.make(1), actual: Revision.make(3) }),
      ),
    ).toBe(true);
    expect(isStaleNodeError(new NameConflict({ parentId: Option.none(), name: "a" }))).toBe(false);
  });
});

describe("shouldRetry", () => {
  it("retries network and server failures a couple of times", () => {
    expect(shouldRetry(0, transportError)).toBe(true);
    expect(shouldRetry(1, statusError(502))).toBe(true);
    expect(shouldRetry(2, statusError(502))).toBe(false);
  });

  it("never retries answers that won't change", () => {
    expect(shouldRetry(0, new NodeNotFound({ id }))).toBe(false);
    expect(shouldRetry(0, statusError(401))).toBe(false);
    expect(shouldRetry(0, new HttpApiError.Unauthorized())).toBe(false);
  });
});
