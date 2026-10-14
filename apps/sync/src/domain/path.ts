import { Option, Schema } from "effect";
import { nodeNameProblem } from "@effect-app/domain/drive";

export const RelativePath = Schema.String.check(
  Schema.makeFilter((path: string) =>
    path.length > 0 &&
    path === path.normalize("NFC") &&
    path.split("/").every((segment) => nodeNameProblem(segment) === undefined)
      ? true
      : "Expected a normalized relative path",
  ),
).pipe(Schema.brand("RelativePath"));
export type RelativePath = typeof RelativePath.Type;

export const CONTROL_DIRECTORY = ".effectsync";

const IGNORED_NAMES = new Set([CONTROL_DIRECTORY, ".DS_Store", "Thumbs.db", "desktop.ini"]);

export const isIgnoredName = (name: string): boolean =>
  IGNORED_NAMES.has(name) ||
  name.startsWith("._") ||
  name.startsWith("~$") ||
  name.endsWith(".swp");

export const segments = (path: RelativePath): ReadonlyArray<string> => path.split("/");

export const basename = (path: RelativePath): string => path.slice(path.lastIndexOf("/") + 1);

export const parentOf = (path: RelativePath): Option.Option<RelativePath> => {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? Option.none() : Option.some(RelativePath.make(path.slice(0, slash)));
};

export const child = (parent: Option.Option<RelativePath>, name: string): RelativePath =>
  RelativePath.make(
    Option.match(parent, {
      onNone: () => name.normalize("NFC"),
      onSome: (prefix) => `${prefix}/${name.normalize("NFC")}`,
    }),
  );

export const isWithin = (path: RelativePath, ancestor: RelativePath): boolean =>
  path.startsWith(`${ancestor}/`);

export const isIgnored = (path: RelativePath): boolean => segments(path).some(isIgnoredName);

export const fromSegments = (parts: ReadonlyArray<string>): Option.Option<RelativePath> =>
  Schema.decodeOption(RelativePath)(
    parts
      .filter((part) => part.length > 0)
      .join("/")
      .normalize("NFC"),
  );
