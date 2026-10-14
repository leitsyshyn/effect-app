import { DateTime } from "effect";

const stamp = (at: DateTime.Utc) =>
  DateTime.formatIso(at).slice(0, 19).replace("T", " ").replaceAll(":", "-");

export const conflictName = (name: string, at: DateTime.Utc, device: string): string => {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  const label = device.replace(/[/\\\0]/g, "-").trim();
  return `${stem} (conflict ${stamp(at)}${label === "" ? "" : ` ${label}`})${extension}`;
};
