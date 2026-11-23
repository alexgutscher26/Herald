"use client";

import { ArrowBigUp, Plus, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import {
  listOnBehalfBoardsAction,
  searchOnBehalfCustomersAction,
  submitFeedbackOnBehalfAction,
  voteOnBehalfAction,
  type OnBehalfBoard,
  type OnBehalfCustomer,
} from "./on-behalf-actions";

/**
 * Operator dialog for acting as a named customer.
 *
 * The selected customer is the real author/voter; the server action records the
 * operator separately, audits it and rate-limits each path. This dialog never
 * creates a customer or a session.
 */

type Props =
  | {
      workspaceSlug: string;
      productSlug: string;
      mode: "submit";
      postId?: never;
      triggerLabel?: string;
    }
  | {
      workspaceSlug: string;
      productSlug: string;
      mode: "vote";
      postId: string;
      triggerLabel?: string;
    };

const CATEGORIES = [
  { value: "feature_request", label: "Feature request" },
  { value: "bug", label: "Bug" },
  { value: "improvement", label: "Improvement" },
  { value: "question", label: "Question" },
] as const;

export function OnBehalfDialog(props: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [boards, setBoards] = useState<OnBehalfBoard[]>([]);
  const [customers, setCustomers] = useState<OnBehalfCustomer[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [boardId, setBoardId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] =
    useState<(typeof CATEGORIES)[number]["value"]>("feature_request");
  const [privacy, setPrivacy] = useState<"public" | "author" | "company">("public");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selected = customers.find((customer) => customer.id === selectedId) ?? null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    void listOnBehalfBoardsAction({
      workspaceSlug: props.workspaceSlug,
      productSlug: props.productSlug,
    }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setBoards(result.data.boards);
        setBoardId((current) => current || result.data.boards[0]?.id || "");
      } else {
        setError(result.error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [open, props.workspaceSlug, props.productSlug]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const timer = window.setTimeout(() => {
      void searchOnBehalfCustomersAction({
        workspaceSlug: props.workspaceSlug,
        productSlug: props.productSlug,
        query,
      }).then((result) => {
        if (cancelled) return;
        if (result.ok) setCustomers(result.data.customers);
      });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, props.workspaceSlug, props.productSlug]);

  async function submit() {
    if (!selected) {
      setError("Choose a customer first.");
      return;
    }
    setBusy(true);
    setError("");

    const result = await submitFeedbackOnBehalfAction({
      workspaceSlug: props.workspaceSlug,
      productSlug: props.productSlug,
      customerId: selected.id,
      boardId,
      title,
      body,
      category,
      privacy,
    });

    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    toast.success("Request submitted on behalf of the customer", {
      description: "The author is the customer; the action is in the workspace audit log.",
    });
    setTitle("");
    setBody("");
    setOpen(false);
    setBusy(false);
    router.refresh();
  }

  async function vote(customer: OnBehalfCustomer) {
    if (props.mode !== "vote") return;
    setBusy(true);
    setError("");

    const result = await voteOnBehalfAction({
      workspaceSlug: props.workspaceSlug,
      productSlug: props.productSlug,
      customerId: customer.id,
      postId: props.postId,
    });

    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    if (result.data.added) {
      toast.success("Vote added on behalf of the customer", {
        description: "The vote belongs to the customer and is recorded in the audit log.",
      });
      router.refresh();
    } else {
      toast.info("That customer already voted");
    }
    setBusy(false);
  }

  const label =
    props.triggerLabel ?? (props.mode === "submit" ? "Submit on behalf…" : "Add customer vote…");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="justify-start">
          {props.mode === "submit" ? <Plus aria-hidden="true" /> : <ArrowBigUp aria-hidden="true" />}
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {props.mode === "submit" ? "Submit on behalf of a customer" : "Add a vote as a customer"}
          </DialogTitle>
          <DialogDescription>
            The customer stays the author or voter. Your operator account is recorded
            separately and the action is written to the workspace audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="on-behalf-search">Customer</Label>
          <Input
            id="on-behalf-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or email…"
            autoComplete="off"
          />
          <ul className="max-h-44 divide-y overflow-y-auto rounded-md border">
            {customers.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">No customers found.</li>
            ) : (
              customers.map((customer) => {
                const isSelected = customer.id === selectedId;
                return (
                  <li key={customer.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (props.mode === "submit") {
                          setSelectedId(customer.id);
                          if (!customer.companies.length) setPrivacy("public");
                        } else {
                          void vote(customer);
                        }
                      }}
                      disabled={busy}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60 disabled:opacity-60 ${
                        isSelected ? "bg-primary/5" : ""
                      }`}
                    >
                      <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {customer.name ?? customer.email ?? "Unnamed customer"}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[customer.email, customer.companies.join(", ")]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      {props.mode === "vote" ? (
                        <span className="shrink-0 text-xs font-medium text-primary">Add vote</span>
                      ) : isSelected ? (
                        <span className="shrink-0 text-xs font-medium text-primary">Selected</span>
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        {props.mode === "submit" ? (
          <>
            <div className="grid gap-2">
              <Label htmlFor="on-behalf-board">Board</Label>
              <Select value={boardId} onValueChange={setBoardId}>
                <SelectTrigger id="on-behalf-board">
                  <SelectValue placeholder="Choose a board" />
                </SelectTrigger>
                <SelectContent>
                  {boards.map((board) => (
                    <SelectItem key={board.id} value={board.id}>
                      {board.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="on-behalf-title">Title</Label>
              <Input
                id="on-behalf-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                minLength={3}
                maxLength={140}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="on-behalf-body">Details</Label>
              <Textarea
                id="on-behalf-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="min-h-28"
                minLength={10}
                maxLength={5_000}
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="on-behalf-category">Type</Label>
                <Select
                  value={category}
                  onValueChange={(value) =>
                    setCategory(value as (typeof CATEGORIES)[number]["value"])
                  }
                >
                  <SelectTrigger id="on-behalf-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="on-behalf-privacy">Audience</Label>
                <Select
                  value={privacy}
                  onValueChange={(value) =>
                    setPrivacy(value as "public" | "author" | "company")
                  }
                >
                  <SelectTrigger id="on-behalf-privacy">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Everyone</SelectItem>
                    <SelectItem value="author">Only the customer</SelectItem>
                    {selected && selected.companies.length > 0 ? (
                      <SelectItem value="company">Company only</SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}

        {props.mode === "submit" ? (
          <DialogFooter>
            <Button
              type="button"
              onClick={submit}
              disabled={
                busy ||
                !selected ||
                !boardId ||
                title.trim().length < 3 ||
                body.trim().length < 10
              }
            >
              {busy ? "Submitting…" : "Submit as customer"}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
