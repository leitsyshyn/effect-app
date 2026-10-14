import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";

export interface ToastAction {
  readonly label: string;
  readonly onClick: () => void;
}

let nextId = 0;

export const toastActions = (actions: ReadonlyArray<ToastAction>) => {
  nextId += 1;
  const id = `toast-${nextId}`;
  return {
    id,
    action: (
      <div className="flex shrink-0 gap-2">
        {actions.map((action, index) => (
          <Button
            key={action.label}
            size="sm"
            variant="outline"
            className={cn(
              "border-current/30 bg-transparent text-current shadow-none hover:bg-current/10 hover:text-current dark:border-current/30 dark:bg-transparent dark:hover:bg-current/10",
              index === actions.length - 1 && "bg-current/10 dark:bg-current/10",
            )}
            onClick={() => {
              action.onClick();
              toast.dismiss(id);
            }}
          >
            {action.label}
          </Button>
        ))}
      </div>
    ),
  };
};
