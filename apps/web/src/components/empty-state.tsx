import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  alert = false,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  alert?: boolean;
  className?: string;
}) {
  return (
    <Empty role={alert ? "alert" : undefined} className={className}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description !== undefined && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action !== undefined && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}
