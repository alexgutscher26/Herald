import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  deleteSurveyAction,
  setSurveyStatusAction,
} from "@/features/engagement/actions";
import { getSurveyResults } from "@/features/engagement/service";
import { conditionSummary } from "@/features/engagement/survey-logic";
import { describeRule } from "@/features/engagement/rules";
import { npsBucket } from "@/features/engagement/nps";
import { requireProductContext } from "@/lib/authz";

export const metadata = { title: "Survey results" };

function bucketLabel(score: number | null): string {
  const bucket = score === null ? null : npsBucket(score);
  return bucket === null ? "" : ` · ${bucket}`;
}

function impressionSentence(usage: {
  used: number;
  limit: number | null;
  remaining: number | null;
}) {
  if (usage.limit === null) {
    return `${usage.used} proactive impressions this month · unlimited on this plan`;
  }
  return `${usage.used} of ${usage.limit} proactive impressions used this month${
    usage.remaining === 0 ? " · allowance reached, widget prompts paused" : ""
  }`;
}

export default async function SurveyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string; surveyId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { workspaceSlug, productSlug, surveyId } = await params;
  const status = await searchParams;
  const context = await requireProductContext(workspaceSlug, productSlug, "settings:manage");
  const results = await getSurveyResults(context.product.id, surveyId);
  if (!results) notFound();
  const hidden = (
    <>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="productSlug" value={productSlug} />
      <input type="hidden" name="surveyId" value={surveyId} />
    </>
  );
  const base = `/app/${workspaceSlug}/${productSlug}/surveys/${surveyId}`;
  const trendMax = Math.max(1, ...results.npsTrend.map((point) => point.responses));

  return (
    <div className="space-y-6">
      <PageHeader
        title={results.survey.name}
        description={`${results.survey.kind.toUpperCase()} survey · ${results.responseCount} responses · ${results.survey.status}`}
      />
      {status.error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {status.error}
        </p>
      ) : null}
      {status.saved ? (
        <p className="rounded-md border border-success/30 bg-success-muted px-3 py-2 text-sm text-success">
          Saved.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link href={`/app/${workspaceSlug}/${productSlug}/surveys`}>Back to surveys</Link>
        </Button>
        {results.survey.status === "active" ? (
          <Button asChild variant="outline">
            <Link
              href={`/p/${workspaceSlug}/${productSlug}/surveys/${results.survey.slug}`}
              target="_blank"
            >
              Open public survey
            </Link>
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <a href={`/api/app/${workspaceSlug}/${productSlug}/surveys/${surveyId}/export`}>
            Export CSV
          </a>
        </Button>
        <form action={setSurveyStatusAction}>
          {hidden}
          <input
            type="hidden"
            name="status"
            value={results.survey.status === "active" ? "paused" : "active"}
          />
          <Button type="submit" variant="outline">
            {results.survey.status === "active" ? "Pause" : "Activate"}
          </Button>
        </form>
        <form action={deleteSurveyAction}>
          {hidden}
          <Button type="submit" variant="destructive">
            Delete
          </Button>
        </form>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Responses", String(results.responseCount)],
          ["Response rate", results.responseRate === null ? "—" : `${results.responseRate}%`],
          ["Average", results.average === null ? "—" : String(results.average)],
          results.survey.kind === "nps"
            ? ["NPS", results.nps === null ? "—" : String(results.nps.score)]
            : ["Opt-ins", String(results.optedInCount)],
          ["Feedback created", String(results.feedbackCount)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="pt-5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Response rate uses known-customer responses over the {results.eligibleCount}{" "}
        customers currently matching this survey&apos;s audience. Anonymous responses are
        counted in Responses but never in the rate.
      </p>
      <p className="text-xs text-muted-foreground">{impressionSentence(results.impressions)}</p>

      {results.nps ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Promoter split</CardTitle>
              <CardDescription>
                Promoters 9–10, passives 7–8, detractors 0–6. Passives count in the
                denominator, never the numerator.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div
                  className="bg-success"
                  style={{ width: `${results.nps.promoterPct}%` }}
                />
                <div
                  className="bg-warning"
                  style={{ width: `${results.nps.passivePct}%` }}
                />
                <div
                  className="bg-destructive"
                  style={{ width: `${results.nps.detractorPct}%` }}
                />
              </div>
              <div className="space-y-1.5 text-sm">
                {[
                  ["Promoters", results.nps.promoters, results.nps.promoterPct, "bg-success"],
                  ["Passives", results.nps.passives, results.nps.passivePct, "bg-warning"],
                  ["Detractors", results.nps.detractors, results.nps.detractorPct, "bg-destructive"],
                ].map(([label, total, share, color]) => (
                  <div key={String(label)} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <span className={`size-2 rounded-full ${color}`} aria-hidden />
                      {label}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {total} · {share}%
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                NPS = promoter % − detractor % = {results.nps.score} from{" "}
                {results.nps.total} rating{results.nps.total === 1 ? "" : "s"}.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>NPS trend</CardTitle>
              <CardDescription>
                Weekly score for the last eight UTC weeks. A dot means no answers that
                week; the score is not carried forward.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex h-28 items-end gap-1.5" role="img" aria-label="Weekly NPS trend">
                {results.npsTrend.map((point) => (
                  <div key={point.start} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                    <div className="flex h-24 w-full items-end">
                      <div
                        className={
                          point.score === null
                            ? "h-1 w-full rounded-sm bg-muted"
                            : point.score >= 0
                              ? "w-full rounded-sm bg-success"
                              : "w-full rounded-sm bg-destructive"
                        }
                        style={{
                          height:
                            point.score === null
                              ? undefined
                              : `${Math.max(4, ((point.score + 100) / 200) * 100)}%`,
                        }}
                        title={`${point.label}: ${
                          point.score === null
                            ? "no answers"
                            : `NPS ${point.score} from ${point.responses}`
                        }`}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{point.label}</span>
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {point.score === null ? "—" : point.score}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Tallest week: {trendMax} rating{trendMax === 1 ? "" : "s"}.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Question results</CardTitle>
            <CardDescription>
              Conditional questions are only counted for respondents who saw them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {results.questionResults.map((question) => {
              const condition = conditionSummary(question, results.survey.questions);
              return (
                <div key={question.id}>
                  <p className="text-sm font-medium">{question.prompt}</p>
                  <p className="text-xs text-muted-foreground">
                    {question.type} · {question.answered} answered
                    {condition ? ` · ${condition}` : ""}
                  </p>
                  <div className="mt-2 space-y-1">
                    {question.answers.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No answers yet.</p>
                    ) : (
                      question.answers.slice(0, 12).map((answer) => (
                        <div
                          key={answer.answer}
                          className="flex items-start justify-between gap-3 text-sm"
                        >
                          <span className="min-w-0 break-words">{answer.answer}</span>
                          <span className="tabular-nums text-muted-foreground">{answer.total}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Keyword themes</CardTitle>
              <CardDescription>
                Words and two-word phrases repeated across different free-text answers
                ({results.textAnswerCount} answer{results.textAnswerCount === 1 ? "" : "s"}).
                Frequency only — read the answers before acting on a theme.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {results.themes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No repeated theme yet. Themes appear once at least two respondents use the
                  same word or phrase.
                </p>
              ) : (
                <div className="space-y-2">
                  {results.themes.map((theme) => (
                    <div key={theme.term} className="space-y-1">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate">
                          {theme.term}
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {theme.kind}
                          </span>
                        </span>
                        <span className="tabular-nums text-muted-foreground">{theme.count}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary/70"
                          style={{
                            width: `${(theme.count / (results.themes[0]?.count ?? 1)) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Trigger and audience</CardTitle>
              <CardDescription>
                The widget shows this survey when every rule matches. Page, time, selector
                and event rules are evaluated in the browser.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {results.survey.audience.length === 0 ? (
                <p className="text-muted-foreground">
                  Everyone. No audience rule, no page and no event trigger.
                </p>
              ) : (
                <ul className="list-disc space-y-1 pl-4">
                  {results.survey.audience.map((rule, index) => (
                    <li key={`${rule.type}-${index}`}>{describeRule(rule)}</li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                Suppression: the same visitor is asked again at most once every{" "}
                {results.survey.suppressDays} day
                {results.survey.suppressDays === 1 ? "" : "s"} after a response, and at
                most once a day while the prompt is live.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent responses</CardTitle>
          <CardDescription>
            Opt-in is recorded separately; only opted-in respondents have a request
            created. Open a response for every answer.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {results.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No responses yet.</p>
          ) : (
            results.recent.map((response) => (
              <Link
                key={response.id}
                href={`${base}/responses/${response.id}`}
                className="block rounded-md border p-2.5 text-sm hover:border-primary/40"
              >
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{response.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                  <span>
                    {response.score ?? "—"}
                    {bucketLabel(response.score)}
                    {response.optedIn ? " · opted in" : ""}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs">
                  {Object.values(response.answers).filter(Boolean).join(" · ") || "No answers"}
                </p>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
