import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { nodeNameProblem } from "@effect-app/domain/drive";
import { Input } from "@/components/ui/input";
import { extensionOf } from "@/features/files/lib/file-names";

export function InlineNameInput({
  label,
  initialName,
  selectStem = false,
  cancelOnBlur = false,
  pending,
  onSubmit,
  onCancel,
}: {
  label: string;
  initialName: string;
  selectStem?: boolean;
  cancelOnBlur?: boolean;
  pending: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const settled = useRef(false);
  const problem = nodeNameProblem(name.normalize("NFC"));

  useLayoutEffect(() => {
    const element = input.current;
    if (element === null) return;
    element.focus();
    element.setSelectionRange(
      0,
      selectStem ? initialName.length - extensionOf(initialName).length : initialName.length,
    );
  }, [initialName, selectStem]);

  const wasPending = useRef(pending);
  useEffect(() => {
    if (wasPending.current && !pending) {
      settled.current = false;
      input.current?.focus();
    }
    wasPending.current = pending;
  }, [pending]);

  const cancel = () => {
    settled.current = true;
    onCancel();
  };
  const save = (fromBlur: boolean) => {
    if (settled.current || pending) return;
    const trimmed = name.trim();
    if (trimmed === "") return cancel();
    if (problem !== undefined) {
      if (fromBlur) return cancel();
      toast.error(problem);
      return;
    }
    settled.current = true;
    onSubmit(trimmed);
  };

  return (
    <Input
      ref={input}
      aria-label={label}
      value={name}
      autoComplete="off"
      spellCheck={false}
      readOnly={pending}
      aria-invalid={problem !== undefined}
      className="h-8 max-w-md min-w-0 flex-1 py-1"
      onChange={(event) => setName(event.target.value)}
      onBlur={() => {
        if (settled.current || pending) return;
        if (cancelOnBlur) cancel();
        else save(true);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          save(false);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
    />
  );
}
