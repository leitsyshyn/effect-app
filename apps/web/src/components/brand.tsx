import { HardDriveIcon } from "lucide-react";
import { cn } from "cn";

export const APP_NAME = "Effect Drive";

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 font-semibold", className)}>
      <span
        aria-hidden
        className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground"
      >
        <HardDriveIcon className="size-4" />
      </span>
      {APP_NAME}
    </span>
  );
}
