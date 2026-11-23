"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toastActionFailure } from "@/components/shared/action-toast";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { defaultMetricsFor, type ReportDatasetDefinition } from "./catalogue";
import { createReportAction } from "./actions";

/**
 * Report builder.
 *
 * Dataset and metric options come from the server catalogue, so the form can
 * only offer values the query module accepts. The action validates again; this
 * component is a convenience, not the authorization boundary.
 */

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

export function ReportBuilder({
  workspaceSlug,
  productSlug,
  datasets,
}: {
  workspaceSlug: string;
  productSlug: string;
  datasets: readonly ReportDatasetDefinition[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [datasetKey, setDatasetKey] = useState(datasets[0]?.key ?? "product_activity");
  const [metrics, setMetrics] = useState<string[]>(defaultMetricsFor(datasetKey));
  const [days, setDays] = useState(30);
  const [comparePrevious, setComparePrevious] = useState(true);
  const [schedule, setSchedule] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [format, setFormat] = useState<"csv" | "pdf">("csv");
  const [recipients, setRecipients] = useState("");
  const [showOnDashboard, setShowOnDashboard] = useState(true);
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [alertMetric, setAlertMetric] = useState("");
  const [alertOperator, setAlertOperator] = useState<"above" | "below">("above");
  const [alertValue, setAlertValue] = useState("0");

  const dataset = datasets.find((item) => item.key === datasetKey) ?? datasets[0];
  const metricOptions = dataset?.metrics ?? [];

  function chooseDataset(nextKey: string) {
    setDatasetKey(nextKey);
    setMetrics(defaultMetricsFor(nextKey));
    setAlertMetric("");
  }

  function toggleMetric(key: string) {
    setMetrics((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  function submit() {
    startTransition(async () => {
      const recipientList = recipients
        .split(/[\s,;]+/)
        .map((value) => value.trim())
        .filter(Boolean);
      const result = await createReportAction({
        workspaceSlug,
        productSlug,
        name,
        description: description.trim() || null,
        dataset: datasetKey,
        metrics,
        days,
        comparePrevious,
        schedule,
        format,
        recipients: recipientList,
        alert: alertEnabled
          ? {
              metric: alertMetric || metrics[0] || "",
              operator: alertOperator,
              value: Number(alertValue),
            }
          : null,
        showOnDashboard,
      });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      setName("");
      setDescription("");
      router.refresh();
    });
  }

  return (
    <Card id="report-builder" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="text-sm">Build a report</CardTitle>
        <p className="text-xs text-muted-foreground">
          Pick from the metric catalogue, compare with the previous period, schedule a
          CSV/PDF export and set a threshold alert.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="report-name">Name</Label>
            <Input
              id="report-name"
              value={name}
              maxLength={120}
              placeholder="Weekly product activity"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-dataset">Dataset</Label>
            <select
              id="report-dataset"
              className={SELECT_CLASS}
              value={datasetKey}
              onChange={(event) => chooseDataset(event.target.value)}
            >
              {datasets.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{dataset?.description}</p>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium">Metrics (up to 8)</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {metricOptions.map((metric) => (
              <label
                key={metric.key}
                className="flex items-start gap-2 rounded-md border bg-background px-2.5 py-2 text-xs"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={metrics.includes(metric.key)}
                  onChange={() => toggleMetric(metric.key)}
                />
                <span>
                  <span className="block font-medium">{metric.label}</span>
                  <span className="block text-muted-foreground">{metric.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="report-days">Period (days)</Label>
            <Input
              id="report-days"
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-schedule">Schedule</Label>
            <select
              id="report-schedule"
              className={SELECT_CLASS}
              value={schedule}
              onChange={(event) =>
                setSchedule(event.target.value as typeof schedule)
              }
            >
              <option value="none">Manual only</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-format">Export format</Label>
            <select
              id="report-format"
              className={SELECT_CLASS}
              value={format}
              onChange={(event) => setFormat(event.target.value as typeof format)}
            >
              <option value="csv">CSV</option>
              <option value="pdf">PDF</option>
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="report-recipients">Email recipients</Label>
          <Input
            id="report-recipients"
            value={recipients}
            placeholder="ops@example.com, founder@example.com"
            onChange={(event) => setRecipients(event.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Required for a scheduled export. Alerts are only emailed on the first crossing,
            not every run.
          </p>
        </div>

        <div className="grid gap-3 rounded-md border bg-muted/25 p-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={comparePrevious}
              onChange={(event) => setComparePrevious(event.target.checked)}
            />
            Compare with the previous period
          </label>
          <label className="flex items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={showOnDashboard}
              onChange={(event) => setShowOnDashboard(event.target.checked)}
            />
            Show on the analytics dashboard
          </label>
          <label className="flex items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={alertEnabled}
              onChange={(event) => setAlertEnabled(event.target.checked)}
            />
            Threshold alert
          </label>
          {alertEnabled ? (
            <div className="grid grid-cols-[1fr_auto_5rem] items-center gap-1.5">
              <select
                aria-label="Alert metric"
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={alertMetric || metrics[0] || ""}
                onChange={(event) => setAlertMetric(event.target.value)}
              >
                {metricOptions
                  .filter((metric) => metrics.includes(metric.key))
                  .map((metric) => (
                    <option key={metric.key} value={metric.key}>
                      {metric.label}
                    </option>
                  ))}
              </select>
              <select
                aria-label="Alert operator"
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={alertOperator}
                onChange={(event) =>
                  setAlertOperator(event.target.value as "above" | "below")
                }
              >
                <option value="above">above</option>
                <option value="below">below</option>
              </select>
              <Input
                aria-label="Alert threshold"
                type="number"
                className="h-8"
                value={alertValue}
                onChange={(event) => setAlertValue(event.target.value)}
              />
            </div>
          ) : null}
        </div>

        <Button type="button" onClick={submit} disabled={pending || !name.trim() || metrics.length === 0}>
          <Plus aria-hidden="true" />
          {pending ? "Saving…" : "Save report"}
        </Button>
      </CardContent>
    </Card>
  );
}
