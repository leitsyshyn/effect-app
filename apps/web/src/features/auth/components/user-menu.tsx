import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LogOutIcon } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/lib/auth/client";

const initialsOf = (name: string) => {
  const words = name
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== "");
  const first = words[0]?.[0] ?? "?";
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
};

export function UserMenu({ name, email }: { name: string; email: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOutMutation = useMutation({
    mutationFn: async () => {
      const { error } = await signOut();
      if (error !== null) throw new Error(error.message ?? error.statusText);
    },
    onSuccess: async () => {
      queryClient.clear();
      await navigate({ to: "/sign-in" });
    },
    onError: (error) => {
      toast.error(`Couldn't sign out: ${error.message}`);
    },
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label={`Account: ${name}`}
        >
          <Avatar>
            <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
              {initialsOf(name)}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate font-medium">{name}</span>
          <span className="block truncate text-muted-foreground">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={signOutMutation.isPending}
          onSelect={() => signOutMutation.mutate()}
        >
          <LogOutIcon aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
