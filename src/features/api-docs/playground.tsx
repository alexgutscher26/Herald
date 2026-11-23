"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { OpenApiOperation } from "./openapi-lib";

type PlaygroundResult = {
  status: number;
  body: string;
  contentType: string | null;
};

/**
 * Browser playground. The workspace token is held only in local component
 * state and sent to the server proxy; it is never persisted. The proxy checks
 * the token's scope before a write, independent of any UI hint.
 */
export function ApiPlayground({ operations }: { operations: OpenApiOperation[] }) {
  const first = operations.find((operation) => !operation.write) ?? operations[0];
  const [token, setToken] = useState("");
  const [method, setMethod] = useState(first?.method ?? "GET");
  const [path, setPath] = useState(first?.path ?? "/api/v1/me");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/public/api-docs/playground", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, method, path, body }),
      });
      const payload = (await response.json().catch(() => null)) as
        | PlaygroundResult
        | { error?: { message?: string } }
        | null;
      if (!response.ok || !payload || !("status" in payload)) {
        setError(
          payload && "error" in payload && payload.error?.message
            ? payload.error.message
            : "The request could not be sent.",
        );
        return;
      }
      setResult(payload);
    } catch {
      setError("The request could not be sent.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-10 rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">Interactive playground</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Use a workspace API token. Writes are refused unless the token has the{" "}
        <code>write</code> scope.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[7rem_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="playground-method">Method</Label>
          <select
            id="playground-method"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
          >
            {["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="playground-path">Path</Label>
          <Input
            id="playground-path"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/api/v1/boards"
          />
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        <Label htmlFor="playground-token">Workspace token</Label>
        <Input
          id="playground-token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="hrl_…"
        />
      </div>
      <div className="mt-3 space-y-1.5">
        <Label htmlFor="playground-body">JSON body</Label>
        <textarea
          id="playground-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={5}
          className="w-full rounded-md border border-input bg-card p-3 font-mono text-xs"
          placeholder='{"board_id":"…"}'
        />
      </div>
      <Button
        type="button"
        className="mt-3"
        disabled={pending || token.trim().length === 0 || path.trim().length === 0}
        onClick={send}
      >
        {pending ? "Sending…" : "Send request"}
      </Button>

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      {result ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-medium">
            HTTP {result.status} · {result.contentType ?? "unknown content type"}
          </p>
          <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
            {result.body}
          </pre>
        </div>
      ) : null}
    </section>
  );
}
