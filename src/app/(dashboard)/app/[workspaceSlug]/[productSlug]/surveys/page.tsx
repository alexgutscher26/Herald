import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSurveyAction, setSurveyStatusAction } from "@/features/engagement/actions";
import { listSurveys } from "@/features/engagement/service";
import { resolveProductPage } from "@/lib/product-page";

export const metadata = { title: "Surveys" };

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm";
const TEXTAREA_CLASS =
  "w-full rounded-md border border-input bg-card p-3 font-mono text-xs leading-5";

export default async function SurveysPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
    const status = await searchParams;
  const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "settings:manage");
  const surveys = await listSurveys(context.product.id);
  const hidden = (
    <>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="productSlug" value={productSlug} />
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Surveys"
        description="Targeted NPS, CSAT and custom surveys with branching follow-ups, page or event triggers, and an explicit opt-in before a response becomes feedback."
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader>
            <CardTitle>All surveys</CardTitle>
            <CardDescription>
              Active surveys are discoverable on the portal and can be embedded on any
              public page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {surveys.length === 0 ? (
              <p className="text-sm text-muted-foreground">No surveys yet.</p>
            ) : (
              surveys.map((survey) => (
                <div
                  key={survey.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/app/${workspaceSlug}/${productSlug}/surveys/${survey.id}`}
                      className="font-medium hover:underline"
                    >
                      {survey.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {survey.kind.toUpperCase()} · {survey.responseCount} responses ·{" "}
                      {survey.status}
                    </p>
                  </div>
                  <form action={setSurveyStatusAction} className="flex items-center gap-2">
                    {hidden}
                    <input type="hidden" name="surveyId" value={survey.id} />
                    <select
                      name="status"
                      defaultValue={survey.status}
                      className={SELECT_CLASS}
                      aria-label={`Status for ${survey.name}`}
                    >
                      <option value="draft">Draft</option>
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                    </select>
                    <Button size="sm" variant="outline" type="submit">
                      Save
                    </Button>
                  </form>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>New survey</CardTitle>
            <CardDescription>
              Questions are stored as data. Rating questions use 0–10 for NPS and 1–5
              for CSAT. A follow-up adds a <code>condition</code> naming an earlier
              question&apos;s id and answer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createSurveyAction} className="space-y-3">
              {hidden}
              <div className="space-y-1.5">
                <Label htmlFor="survey-name">Name</Label>
                <Input id="survey-name" name="name" required maxLength={160} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="survey-kind">Type</Label>
                  <select id="survey-kind" name="kind" className={SELECT_CLASS}>
                    <option value="nps">NPS</option>
                    <option value="csat">CSAT</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="suppress-days">Suppress days</Label>
                  <Input
                    id="suppress-days"
                    name="suppressDays"
                    type="number"
                    min={0}
                    max={365}
                    defaultValue={30}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="survey-questions">Questions (JSON)</Label>
                <textarea
                  id="survey-questions"
                  name="questions"
                  rows={10}
                  className={TEXTAREA_CLASS}
                  defaultValue={JSON.stringify(
                    [
                      {
                        id: "score",
                        type: "rating",
                        prompt: "How likely are you to recommend us?",
                        required: true,
                      },
                      {
                        id: "used",
                        type: "choice",
                        prompt: "Did you use the export?",
                        options: ["Yes", "No"],
                      },
                      {
                        id: "reason",
                        type: "text",
                        prompt: "What went wrong with the export?",
                        condition: { questionId: "used", equals: "Yes" },
                      },
                    ],
                    null,
                    2,
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  A condition may only point at an earlier question and must use an
                  option or rating that question can produce.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="survey-audience">Trigger and audience rules (JSON, optional)</Label>
                <textarea
                  id="survey-audience"
                  name="audience"
                  rows={4}
                  className={TEXTAREA_CLASS}
                  placeholder='[{"type":"page_url","operator":"contains","value":"/billing"}]'
                />
                <p className="text-xs text-muted-foreground">
                  Rules are ANDed. Use an attribute rule for plan or traits, page_url for
                  a page, and an event rule with a name such as checkout_completed for a
                  host-page event fired with HeraldWidget.track() or a data-herald-event
                  click.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" />
                Activate immediately
              </label>
              <Button type="submit" className="w-full">
                Create survey
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
