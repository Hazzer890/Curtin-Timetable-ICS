export interface Activity {
  startDateTime: string;
  endDateTime: string;
  activityType: string;
  unit: { unitCode: string; abbreviatedTitle: string };
  location?: { buildingNumber?: string; roomNumber?: string; name?: string } | null;
}

const PERTH_OFFSET_MS = 8 * 3600_000; // Australia/Perth is fixed +08:00, no DST
const WEEK_MS = 7 * 86400_000;

// Date whose getUTC* fields hold Perth wall-clock time for the given instant.
function perthWall(iso: string): Date {
  return new Date(Date.parse(iso) + PERTH_OFFSET_MS);
}

// YYYYMMDDTHHMMSS from a Date's getUTC* fields.
function fmt(d: Date): string {
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function fold(line: string): string {
  const out: string[] = [];
  while (line.length > 74) {
    out.push(line.slice(0, 74));
    line = " " + line.slice(74);
  }
  out.push(line);
  return out.join("\r\n");
}

function summaryOf(a: Activity): string {
  return `${a.unit.unitCode} ${a.unit.abbreviatedTitle} — ${a.activityType}`;
}

function locationOf(a: Activity): string {
  const l = a.location;
  if (!l) return "";
  return `${l.buildingNumber ?? "?"}.${l.roomNumber ?? "?"} (${l.name ?? ""})`;
}

export type Semester = "all" | "s1" | "s2";

// ponytail: month-window heuristic (S1 = Jan–Jun, S2 = Jul–Dec); swap for real
// teaching-period data if Elsie turns out to expose it.
export function filterSemester(activities: Activity[], sem: Semester): Activity[] {
  if (sem !== "s1" && sem !== "s2") return activities;
  const matches = activities.filter((a) => {
    const m = perthWall(a.startDateTime).getUTCMonth();
    return sem === "s1" ? m < 6 : m >= 6;
  });
  // If Elsie returns activities spanning years, keep only the latest year.
  const latest = Math.max(...matches.map((a) => perthWall(a.startDateTime).getUTCFullYear()));
  return matches.filter((a) => perthWall(a.startDateTime).getUTCFullYear() === latest);
}

export function buildIcs(activities: Activity[], now: Date = new Date()): string {
  const groups = new Map<string, Activity[]>();
  for (const a of activities) {
    const s = perthWall(a.startDateTime);
    const key = [summaryOf(a), locationOf(a), s.getUTCDay(), fmt(s).slice(9), fmt(perthWall(a.endDateTime)).slice(9)].join("|");
    const group = groups.get(key);
    if (group) group.push(a);
    else groups.set(key, [a]);
  }

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//timetable.harrys.monster//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VTIMEZONE",
    "TZID:Australia/Perth",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0800",
    "TZOFFSETTO:+0800",
    "TZNAME:AWST",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];

  let uid = 0;
  const pushEvent = (a: Activity, extra: string[]) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${++uid}-${fmt(perthWall(a.startDateTime))}@timetable.harrys.monster`,
      `DTSTAMP:${fmt(now)}Z`,
      `DTSTART;TZID=Australia/Perth:${fmt(perthWall(a.startDateTime))}`,
      `DTEND;TZID=Australia/Perth:${fmt(perthWall(a.endDateTime))}`,
      ...extra,
      fold(`SUMMARY:${escapeText(summaryOf(a))}`),
    );
    if (locationOf(a)) lines.push(fold(`LOCATION:${escapeText(locationOf(a))}`));
    lines.push("END:VEVENT");
  };

  for (const group of groups.values()) {
    group.sort((x, y) => Date.parse(x.startDateTime) - Date.parse(y.startDateTime));
    const firstEpoch = Date.parse(group[0].startDateTime);
    const weeks = group.map((g) => (Date.parse(g.startDateTime) - firstEpoch) / WEEK_MS);
    const isWeekly = group.length >= 2 && weeks.every((w) => Number.isInteger(w));

    if (!isWeekly) {
      for (const a of group) pushEvent(a, []);
      continue;
    }

    const lastWeek = weeks[weeks.length - 1];
    const present = new Set(weeks);
    const exdates: string[] = [];
    for (let w = 1; w < lastWeek; w++) {
      if (!present.has(w)) exdates.push(fmt(new Date(firstEpoch + w * WEEK_MS + PERTH_OFFSET_MS)));
    }
    const extra = [`RRULE:FREQ=WEEKLY;UNTIL=${fmt(new Date(firstEpoch + lastWeek * WEEK_MS))}Z`];
    if (exdates.length) extra.push(`EXDATE;TZID=Australia/Perth:${exdates.join(",")}`);
    pushEvent(group[0], extra);
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
