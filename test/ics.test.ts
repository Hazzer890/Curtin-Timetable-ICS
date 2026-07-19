import { describe, expect, it } from "vitest";
import { buildIcs, filterSemester, type Activity } from "../src/ics";

const NOW = new Date("2026-07-19T00:00:00Z");

const unit = { unitCode: "COMP1000", abbreviatedTitle: "Intro to Computing" };
const loc = { buildingNumber: "314", roomNumber: "221", name: "Building 314" };

function act(start: string, end: string, over: Partial<Activity> = {}): Activity {
  return { startDateTime: start, endDateTime: end, activityType: "Lecture", unit, location: loc, ...over };
}

describe("buildIcs", () => {
  it("collapses weekly repeats into one RRULE event with EXDATE for gap weeks", () => {
    // Mondays 10:00-12:00 Perth on Aug 3, Aug 10, Aug 24 (Aug 17 skipped)
    const ics = buildIcs(
      [
        act("2026-08-03T10:00:00+08:00", "2026-08-03T12:00:00+08:00"),
        act("2026-08-10T10:00:00+08:00", "2026-08-10T12:00:00+08:00"),
        act("2026-08-24T10:00:00+08:00", "2026-08-24T12:00:00+08:00"),
      ],
      NOW,
    );
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain("DTSTART;TZID=Australia/Perth:20260803T100000");
    expect(ics).toContain("DTEND;TZID=Australia/Perth:20260803T120000");
    // 10:00 Perth = 02:00 UTC
    expect(ics).toContain("RRULE:FREQ=WEEKLY;UNTIL=20260824T020000Z");
    expect(ics).toContain("EXDATE;TZID=Australia/Perth:20260817T100000");
    expect(ics).toContain("COMP1000 Intro to Computing — Lecture");
    expect(ics).toContain("314.221 (Building 314)");
  });

  it("emits a singular event (no RRULE) for one-off activities", () => {
    const ics = buildIcs([act("2026-08-05T14:00:00+08:00", "2026-08-05T15:00:00+08:00", { activityType: "Workshop" })], NOW);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).not.toContain("RRULE");
    expect(ics).toContain("DTSTART;TZID=Australia/Perth:20260805T140000");
  });

  it("does not merge activities in different locations", () => {
    const ics = buildIcs(
      [
        act("2026-08-03T10:00:00+08:00", "2026-08-03T12:00:00+08:00"),
        act("2026-08-10T10:00:00+08:00", "2026-08-10T12:00:00+08:00", {
          location: { buildingNumber: "105", roomNumber: "1", name: "Library" },
        }),
      ],
      NOW,
    );
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).not.toContain("RRULE");
  });

  it("filters by semester month window (S1 Jan–Jun, S2 Jul–Dec)", () => {
    const s1 = act("2026-03-02T10:00:00+08:00", "2026-03-02T12:00:00+08:00");
    const s2 = act("2026-08-03T10:00:00+08:00", "2026-08-03T12:00:00+08:00");
    expect(filterSemester([s1, s2], "s1")).toEqual([s1]);
    expect(filterSemester([s1, s2], "s2")).toEqual([s2]);
    expect(filterSemester([s1, s2], "all")).toEqual([s1, s2]);
  });

  it("is a valid calendar shell with Perth VTIMEZONE and CRLF endings", () => {
    const ics = buildIcs([], NOW);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("TZID:Australia/Perth");
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });
});
