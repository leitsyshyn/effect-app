import { useRef } from "react";

export const useFilePicker = (onFiles: (files: ReadonlyArray<File>) => void) => {
  const input = useRef<HTMLInputElement>(null);
  return {
    open: () => input.current?.click(),
    input: (
      <input
        ref={input}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
    ),
  };
};
