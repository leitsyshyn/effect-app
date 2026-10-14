import { Option } from "effect";
import type { PreviewKind } from "@effect-app/domain/drive";
import { fileTypeOf } from "@effect-app/domain/listing";

const PLAIN_TEXT = "text/plain; charset=utf-8";
const GENERIC = "application/octet-stream";

const PLAIN_TEXT_TYPES = [
  "txt",
  "log",
  "tsv",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "ini",
  "env",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "css",
  "scss",
  "kts",
  "java",
  "swift",
  "py",
  "rb",
  "go",
  "rs",
  "c",
  "h",
  "cpp",
  "cs",
  "php",
  "sh",
  "zsh",
  "sql",
  "graphql",
  "gradle",
  "vue",
  "svelte",
];

const CONTENT_TYPES: Record<string, string> = {
  ...Object.fromEntries(PLAIN_TEXT_TYPES.map((type) => [type, PLAIN_TEXT])),
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  html: "text/html; charset=utf-8",
  kt: "text/x-kotlin; charset=utf-8",
  json: "application/json",
  xml: "application/xml",
  svg: "image/svg+xml",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

export const contentTypeOf = (name: string): string => CONTENT_TYPES[fileTypeOf(name)] ?? GENERIC;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const TEXT_TYPES = new Set(["application/json", "application/xml", "image/svg+xml"]);

const mediaType = (contentType: string) => contentType.split(";")[0]!.trim().toLowerCase();

export const previewOf = (contentType: Option.Option<string>): PreviewKind => {
  if (Option.isNone(contentType)) return "none";
  const type = mediaType(contentType.value);
  if (IMAGE_TYPES.has(type)) return "image";
  if (type.startsWith("text/") || TEXT_TYPES.has(type)) return "text";
  if (type === "application/pdf") return "pdf";
  return "none";
};

export const describeContent = (node: {
  readonly name: string;
  readonly kind: "file" | "folder";
  readonly contentType: Option.Option<string>;
}): { readonly fileType: string; readonly preview: PreviewKind } =>
  node.kind === "folder"
    ? { fileType: "", preview: "none" }
    : { fileType: fileTypeOf(node.name), preview: previewOf(node.contentType) };
