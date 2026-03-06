import type { RefObject } from "react";
import { ChevronDown, UserPlus } from "lucide-react";

import { Button } from "../ui/button";
import { formatCurrency } from "../../lib/admin";
import type { AgentOption } from "../../lib/admin-api";

export const AgentPicker = ({
  agents,
  selectedAgentId,
  selectedAgentName,
  open,
  dropdownRef,
  onToggle,
  onSelect,
  onCreateTrader,
}: {
  agents: AgentOption[];
  selectedAgentId: string;
  selectedAgentName: string | null;
  open: boolean;
  dropdownRef: RefObject<HTMLDivElement>;
  onToggle: () => void;
  onSelect: (userId: string) => void;
  onCreateTrader: () => void;
}) => {
  return (
    <div ref={dropdownRef} className="relative">
      <Button
        id="agent-selector"
        variant="outline"
        className="min-w-[200px] justify-between gap-2"
        onClick={onToggle}
      >
        <span className="max-w-[160px] truncate">
          {selectedAgentName ?? "Select agent…"}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </Button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 animate-in fade-in-0 slide-in-from-top-1 rounded-lg border border-border/70 bg-popover/98 p-1 shadow-panel-strong backdrop-blur-xl duration-150">
          <div className="max-h-60 overflow-y-auto">
            {agents.map((agent) => (
              <button
                key={agent.userId}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent/60 ${
                  selectedAgentId === agent.userId ? "bg-accent/50 font-medium" : ""
                }`}
                onClick={() => onSelect(agent.userId)}
              >
                <span className="truncate">{agent.userName}</span>
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {formatCurrency(agent.balance)}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-1 border-t border-border/50 pt-1">
            <button
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-primary transition-colors hover:bg-accent/60"
              onClick={onCreateTrader}
            >
              <UserPlus className="h-3.5 w-3.5" />
              Create Trader
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
