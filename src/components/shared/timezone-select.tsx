import { TIME_ZONE_GROUPS, isKnownTimeZone } from "@/lib/timezones";

/**
 * A native `<select>` of every IANA time zone, grouped by region.
 *
 * It stays a native select because the surrounding settings forms are
 * server-rendered and must work without JavaScript. The posted value is still a
 * canonical IANA name, so the existing server-side validation is unchanged. A
 * stored value that is not in the list (for example the alias `US/Pacific`) is
 * kept as the first option instead of silently resetting the field.
 */
export function TimeZoneSelect({
  id,
  name = "timezone",
  value,
  disabled = false,
  className,
}: {
  id: string;
  name?: string;
  value: string;
  disabled?: boolean;
  className?: string;
}) {
  const current = value.trim() || "UTC";

  return (
    <select
      id={id}
      name={name}
      defaultValue={current}
      disabled={disabled}
      className={className}
    >
      {isKnownTimeZone(current) ? null : (
        <option value={current}>{current} (current)</option>
      )}
      <option value="UTC">UTC</option>
      {TIME_ZONE_GROUPS.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
