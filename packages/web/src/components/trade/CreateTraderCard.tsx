import { Loader2, Plus, X } from "lucide-react";

import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Input } from "../ui/input";

export const CreateTraderCard = ({
  open,
  name,
  creating,
  onNameChange,
  onCreate,
  onClose,
}: {
  open: boolean;
  name: string;
  creating: boolean;
  onNameChange: (value: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) => {
  if (!open) {
    return null;
  }

  return (
    <Card className="animate-in fade-in-0 slide-in-from-top-1 border-primary/30 bg-card/70 backdrop-blur-xl duration-200">
      <CardContent className="pt-5">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Trader Name
            </label>
            <Input
              id="new-trader-name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="e.g. alice, manual-trader-1"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onCreate();
                }
              }}
            />
          </div>
          <Button onClick={onCreate} disabled={creating || !name.trim()} className="gap-2">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create
          </Button>
          <Button variant="outline" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
