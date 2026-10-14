import { Context, Effect, Layer, Option, Schema } from "effect";
import { UserId } from "@effect-app/domain/user";
import type { User } from "@effect-app/domain/user";
import type { PersistenceError } from "../../infra/db/client";
import { UserRepository } from "./repository";
import type { ListUsersOptions } from "./repository";

export class UserNotFoundError extends Schema.TaggedError<UserNotFoundError>()(
  "UserNotFoundError",
  {
    id: UserId,
  },
) {}

interface UserServiceInterface {
  readonly get: (id: UserId) => Effect.Effect<User, UserNotFoundError | PersistenceError>;
  readonly find: (id: UserId) => Effect.Effect<Option.Option<User>, PersistenceError>;
  readonly list: (
    options: ListUsersOptions,
  ) => Effect.Effect<ReadonlyArray<User>, PersistenceError>;
}

export class UserService extends Context.Service<UserService, UserServiceInterface>()(
  "effect-app/user/UserService",
) {
  static readonly make: Effect.Effect<UserServiceInterface, never, UserRepository> = Effect.gen(
    function* () {
      const userRepository = yield* UserRepository;

      const find = Effect.fn("UserService.find")(function* (id: UserId) {
        return yield* userRepository.findById(id);
      });

      const get = Effect.fn("UserService.get")(function* (id: UserId) {
        const user = yield* userRepository.findById(id);
        return yield* Effect.fromOption(user, () => new UserNotFoundError({ id }));
      });

      const list = Effect.fn("UserService.list")(function* (options: ListUsersOptions) {
        return yield* userRepository.list(options);
      });

      return UserService.of({ get, find, list });
    },
  );

  static readonly layerWithoutDependencies = Layer.effect(UserService, UserService.make);

  static readonly layer = UserService.layerWithoutDependencies.pipe(
    Layer.provide(UserRepository.layer),
  );
}
