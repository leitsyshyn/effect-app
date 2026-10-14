import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { UserId } from "@effect-app/domain/user";
import { UserRepository } from "./repository";
import { UserNotFoundError, UserService } from "./service";
import { PersistenceError } from "../../infra/db/client";
import { makeUser } from "../../testing/fixtures";

const john = makeUser("user-1", "john@example.com");

const emptyUserRepository = UserRepository.of({
  findById: () => Effect.succeedNone,
  list: () => Effect.succeed([]),
});

const provideUserService = (userRepository: UserRepository["Service"]) =>
  Effect.provide(
    UserService.layerWithoutDependencies.pipe(
      Layer.provide(Layer.succeed(UserRepository, userRepository)),
    ),
  );

const userRepositoryWithJohn = UserRepository.of({
  ...emptyUserRepository,
  findById: (id) => Effect.succeed(id === john.id ? Option.some(john) : Option.none()),
});

describe("UserService", () => {
  describe("get", () => {
    it.effect("gets a user by id", () =>
      Effect.gen(function* () {
        const userService = yield* UserService;

        expect(yield* userService.get(UserId.make("user-1"))).toEqual(john);
      }).pipe(provideUserService(userRepositoryWithJohn)),
    );

    it.effect("fails with UserNotFoundError when getting an unknown user", () =>
      Effect.gen(function* () {
        const userService = yield* UserService;
        const error = yield* userService.get(UserId.make("missing")).pipe(Effect.flip);

        expect(error).toEqual(new UserNotFoundError({ id: UserId.make("missing") }));
      }).pipe(provideUserService(userRepositoryWithJohn)),
    );

    it.effect("propagates repository failures", () =>
      Effect.gen(function* () {
        const userService = yield* UserService;
        const error = yield* userService.get(UserId.make("user-1")).pipe(Effect.flip);

        expect(error._tag).toBe("PersistenceError");
      }).pipe(
        provideUserService(
          UserRepository.of({
            ...emptyUserRepository,
            findById: () =>
              Effect.fail(
                new PersistenceError({ operation: "findById", cause: new Error("Database down") }),
              ),
          }),
        ),
      ),
    );
  });

  describe("find", () => {
    it.effect("finds a user by id, or nothing", () =>
      Effect.gen(function* () {
        const userService = yield* UserService;

        expect(yield* userService.find(UserId.make("user-1"))).toEqual(Option.some(john));
        expect(yield* userService.find(UserId.make("missing"))).toEqual(Option.none());
      }).pipe(provideUserService(userRepositoryWithJohn)),
    );
  });

  describe("list", () => {
    it.effect("lists users with the requested page", () =>
      Effect.gen(function* () {
        const userService = yield* UserService;

        expect(yield* userService.list({ limit: 2, offset: 4 })).toEqual([john]);
      }).pipe(
        provideUserService(
          UserRepository.of({
            ...emptyUserRepository,
            list: ({ limit, offset }) => Effect.succeed(limit === 2 && offset === 4 ? [john] : []),
          }),
        ),
      ),
    );
  });
});
