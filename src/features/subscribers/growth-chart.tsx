import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SubscriberGrowthWeek } from "@/db/queries/subscribers";

/**
 * Weekly joins and losses.
 *
 * Drawn with plain elements rather than a chart library: the dashboard already
 * ships no charting dependency, and a dozen bars do not justify one. The data
 * is also exposed as an accessible table for screen readers.
 */
export function SubscriberGrowthChart({ weeks }: { weeks: SubscriberGrowthWeek[] }) {
  const max = Math.max(1, ...weeks.map((week) => Math.max(week.joined, week.lost)));
  const joined = weeks.reduce((total, week) => total + week.joined, 0);
  const lost = weeks.reduce((total, week) => total + week.lost, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Subscriber growth</CardTitle>
          <CardDescription>New and lost subscribers per week, last 12 weeks.</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-success" aria-hidden="true" />
            {joined.toLocaleString("en")} new
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-destructive" aria-hidden="true" />
            {lost.toLocaleString("en")} lost
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex h-40 items-end gap-1.5 overflow-x-auto pb-1">
          {weeks.map((week) => (
            <div
              key={week.weekStart}
              className="flex min-w-6 flex-1 flex-col items-center justify-end gap-1"
              title={`Week of ${week.weekStart}: ${week.joined} new, ${week.lost} lost`}
            >
              <div className="flex h-32 w-full items-end justify-center gap-0.5">
                <span
                  className="w-2 rounded-t bg-success"
                  style={{
                    height: week.joined === 0 ? "2px" : `${Math.max(4, (week.joined / max) * 100)}%`,
                    opacity: week.joined === 0 ? 0.25 : 1,
                  }}
                />
                <span
                  className="w-2 rounded-t bg-destructive"
                  style={{
                    height: week.lost === 0 ? "2px" : `${Math.max(4, (week.lost / max) * 100)}%`,
                    opacity: week.lost === 0 ? 0.25 : 1,
                  }}
                />
              </div>
              <span className="text-[9px] tabular-nums text-muted-foreground">
                {week.weekStart.slice(5)}
              </span>
            </div>
          ))}
        </div>
        <table className="sr-only">
          <caption>Subscriber growth by week</caption>
          <thead>
            <tr>
              <th scope="col">Week</th>
              <th scope="col">New</th>
              <th scope="col">Lost</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week.weekStart}>
                <th scope="row">{week.weekStart}</th>
                <td>{week.joined}</td>
                <td>{week.lost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
