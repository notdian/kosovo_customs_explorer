import { ChevronDown, ChevronRight } from "lucide-react";

type ExpandIconProps = {
  expanded: boolean;
};

export function ExpandIcon({ expanded }: ExpandIconProps) {
  const Icon = expanded ? ChevronDown : ChevronRight;
  return <Icon aria-hidden className="h-3 w-3" strokeWidth={2.5} />;
}
