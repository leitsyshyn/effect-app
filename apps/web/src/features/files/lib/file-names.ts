const MAX_NAME_LENGTH = 255;

export const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
};

export const nameKey = (name: string): string => name.normalize("NFC").toLowerCase();

const COPY_SUFFIX = / \((\d+)\)$/;

export const keepBothName = (name: string, taken: Iterable<string>): string => {
  const takenKeys = new Set(Array.from(taken, nameKey));
  const extension = name.slice(name.length - extensionOf(name).length);
  const stem = name.slice(0, name.length - extension.length);
  const match = COPY_SUFFIX.exec(stem);
  const base = match === null ? stem : stem.slice(0, match.index);
  let counter = match === null ? 1 : Number(match[1]) + 1;
  for (;;) {
    const suffix = ` (${counter})${extension}`;
    const candidate = base.slice(0, MAX_NAME_LENGTH - suffix.length).trimEnd() + suffix;
    if (!takenKeys.has(nameKey(candidate))) return candidate;
    counter += 1;
  }
};
