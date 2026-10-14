import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function IconButton({
  label,
  shortcut,
  variant = "ghost",
  size = "icon",
  ...props
}: ComponentProps<typeof Button> & { label: string; shortcut?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant={variant} size={size} aria-label={label} {...props} />
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut !== undefined && <Kbd className="ml-2">{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}
