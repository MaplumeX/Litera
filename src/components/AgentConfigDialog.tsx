import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { AgentConfigForm } from "@/components/AgentConfigForm";

interface AgentConfigDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AgentConfigDialog({ open, onClose }: AgentConfigDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className={cn("max-h-[85vh] overflow-y-auto", "sm:max-w-md")}
      >
        <DialogHeader>
          <DialogTitle>LLM 设置</DialogTitle>
          <DialogDescription className="sr-only">
            配置 LLM 供应商、API Key 与模型。
          </DialogDescription>
        </DialogHeader>
        <AgentConfigForm active={open} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}
