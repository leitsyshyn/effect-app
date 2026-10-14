import { useCallback, useMemo, useState } from "react";
import {
  parseColumnChoices,
  resolveColumnVisibility,
  withColumnChoice,
} from "@/features/files/lib/columns";
import type { ColumnChoices, MetadataColumnId } from "@/features/files/lib/columns";
import { useMediaQuery } from "@/lib/use-media-query";

const STORAGE_KEY = "drive.columns.v1";
const NARROW_QUERY = "(max-width: 767px)";

const readChoices = (): ColumnChoices => {
  try {
    return parseColumnChoices(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
};

const writeChoices = (choices: ColumnChoices) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choices));
  } catch {}
};

export const useColumnVisibility = ({ besidePanel }: { besidePanel: boolean }) => {
  const [choices, setChoices] = useState(readChoices);
  const isNarrow = useMediaQuery(NARROW_QUERY);

  const visibility = useMemo(
    () => resolveColumnVisibility(choices, isNarrow, besidePanel),
    [choices, isNarrow, besidePanel],
  );

  const setVisible = useCallback((column: MetadataColumnId, visible: boolean) => {
    setChoices((current) => {
      const next = withColumnChoice(current, column, visible);
      writeChoices(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setChoices({});
    writeChoices({});
  }, []);

  return { visibility, setVisible, reset };
};
