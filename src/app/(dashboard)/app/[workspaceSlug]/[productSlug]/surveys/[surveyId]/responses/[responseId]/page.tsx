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
import { getSurveyResponse } from "@/features/engagement/service";
import { conditionSummary } from "@/features/engagement/survey-logic";
import { npsBucket } from "@/features/engagement/nps";
import { requireProductContext } from "@/lib/authz";

export const metadata = { title: "Survey response" };

export default async function SurveyResponsePage({
  params,
}: {
  params: Promise<{
    workspaceSlug: string;
    productSlug: string;
    surveyId: string;
    responseId: string;
  }>;
}) {
  const { workspaceSlug, productSlug, surveyId, responseId } = await params;
  const context = await requireProductContext(workspaceSlug, productSlug, "settings:manage");
  const detail = await getSurveyResponse(context.product.id, surveyId, responseId);
  if (!detail) notFound();

  const { survey, response, customerEmail, visibleQuestions } = detail;
  const visibleIds = new Set(visibleQuestions.map((question) => question.id));
  const bucket = response.score === null ? null : npsBucket(response.score);
  const base = `/app/${workspaceSlug}/${productSlug}/surveys/${surveyId}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Response"
        description={`${survey.name} · ${response.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC`}
      />

      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link href={base}>Back to results</Link>
        </Button>
        {response.feedbackPostId ? (
          <Button asChild variant="outline">
            <Link
              href={`/app/${workspaceSlug}/${productSlug}/feedback?post=${response.feedbackPostId}`}
            >
              Open the feedback request
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Score", response.score === null ? "—" : String(response.score)],
          ["Bucket", bucket ?? "—"],
          ["Opted in", response.optedIn ? "Yes" : "No"],
          ["Customer", customerEmail ?? "Anonymous visitor"],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="pt-5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="mt-1 break-words text-sm font-medium">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Answers</CardTitle>
          <CardDescription>
            A question whose branch was off is marked “not shown”, so an empty answer is
            never confused with a skipped one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {survey.questions.map((question) => {
            const answer = response.answers[question.id];
            const condition = conditionSummary(question, survey.questions);
            const shown = visibleIds.has(question.id);
            return (
              <div key={question.id} className="border-b pb-4 last:border-0 last:pb-0">
                <p className="text-sm font-medium">{question.prompt}</p>
                <p className="text-xs text-muted-foreground">
                  {question.type}
                  {condition ? ` · ${condition}` : ""}
                  {shown ? "" : " · not shown on this branch"}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm">
                  {answer && answer.trim() !== "" ? (
                    answer
                  ) : (
                    <span className="text-muted-foreground">
                      {shown ? "No answer" : "Not shown"}
                    </span>
                  )}
                </p>
              </div>
            );
          })}
          {survey.questions.length === 0 ? (
            <p className="text-sm text-muted-foreground">This survey had no questions.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Response metadata</CardTitle>
          <CardDescription>
            Visitor keys are browser-generated; they identify a device, not a person, and
            are the mechanism behind the once-a-day and suppression rules.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <p>
            Response id <span className="font-mono text-foreground">{response.id}</span>
          </p>
          <p>
            Visitor{" "}
            <span className="font-mono text-foreground">
              {response.visitorKey.slice(0, 12)}…
            </span>
          </p>
          <p>
            Submitted{" "}
            <span className="text-foreground">{response.createdAt.toISOString()}</span>
          </p>
          <p>
            Feedback request{" "}
            <span className="font-mono text-foreground">
              {response.feedbackPostId ?? "none"}
            </span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
