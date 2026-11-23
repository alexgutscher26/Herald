"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CopyButtonProps = {
  value: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  size?: "sm" | "default" | "icon";
  variant?: "default" | "outline" | "secondary" | "ghost";
};

async function writeToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  className,
  size = "sm",
  variant = "outline",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    const ok = await writeToClipboard(value);
    if (!ok) {
      toast.error("Could not copy", {
        description: "Your browser blocked clipboard access. Select the text and copy it manually.",
      });
      return;
    }
    setCopied(true);
    toast.success("Copied to clipboard");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      onClick={copy}
      className={cn(className)}
      aria-live="polite"
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {size === "icon" ? <span className="sr-only">{copied ? copiedLabel : label}</span> : copied ? copiedLabel : label}
    </Button>
  );
}
