# timetable.harrys.monster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Cloudflare Worker at timetable.harrys.monster where a Curtin student enters Elsie credentials and downloads their timetable as an .ics with classes as recurring events.

**Architecture:** One stateless Worker. `GET /` serves an inline HTML form; `POST /generate` logs into the Elsie JSON API, fetches study-activities, and returns an .ics built by a pure function (`src/ics.ts`) that collapses weekly repeats into RRULE events with EXDATEs.

**Tech Stack:** TypeScript, wrangler, vitest. Zero runtime dependencies.

## Global Constraints

- No storage of any kind (no KV/D1/cache); credentials and timetable data must never be logged.
- Elsie API base: `https://elsie.curtin.edu.au/api`; login token is at `data.token` in the sessions response; errors appear in an `errors` field.
- Elsie requests need headers: `User-Agent` (browser-like), `X-Correlation-ID` (random UUID), and for login `Content-Type: application/json;charset=UTF-8`.
- All calendar times are `Australia/Perth` (fixed +08:00, no DST).
- ICS lines use CRLF; text values escaped per RFC 5545; lines folded at 74 chars.
- Spec: `docs/superpowers/specs/2026-07-19-timetable-site-design.md`.

---

### Task 1: Project scaffold + ICS builder

**Files:**
- Create: `package.json`, `tsconfig.json`, `wrangler.jsonc`, `.gitignore`
- Create: `src/ics.ts`
- Test: `test/ics.test.ts`

**Interfaces:**
- Produces: `buildIcs(activities: Activity[], now?: Date): string` and `interface Activity` from `src/ics.ts` — consumed by Task 2.

- [ ] **Step 1: Write scaffold files**

`package.json`:

```json
{
  "name": "timetable-site",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20260705.0",
    "typescript": "^5.5.0",
    "vitest": "^3.0.0",
    "wrangler": "^4.0.0"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src", "test"]
}
```

`wrangler.jsonc`:

```jsonc
{
  "name": "timetable",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-01",
  "routes": [{ "pattern": "timetable.harrys.monster", "custom_domain": true }]
}
```

`.gitignore`:

```
node_modules/
.wrangler/
```

Run: `npm install`
Expected: installs without errors.

- [ ] **Step 2: Write the failing tests**

`test/ics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildIcs, type Activity } from "../src/ics";

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

  it("is a valid calendar shell with Perth VTIMEZONE and CRLF endings", () => {
    const ics = buildIcs([], NOW);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("TZID:Australia/Perth");
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL — cannot resolve `../src/ics`.

- [ ] **Step 4: Implement `src/ics.ts`**

```ts
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

export function buildIcs(activities: Activity[], now: Date = new Date()): string {
  const groups = new Map<string, Activity[]>();
  for (const a of activities) {
    const s = perthWall(a.startDateTime);
    const key = [summaryOf(a), locationOf(a), s.getUTCDay(), fmt(s).slice(9), fmt(perthWall(a.endDateTime)).slice(9)].join("|");
    groups.get(key)?.push(a) ?? groups.set(key, [a]);
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
```

Note: the weekday is part of the group key and Perth has a fixed offset, so
same-key gaps are always whole weeks — `isWeekly` is a cheap guard against
malformed input rather than a branch that fires on real data.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json wrangler.jsonc .gitignore src/ics.ts test/ics.test.ts
git commit -m "feat: ICS builder with weekly RRULE collapsing"
```

---

### Task 2: Worker routes

**Files:**
- Create: `src/index.ts`

**Interfaces:**
- Consumes: `buildIcs(activities: Activity[], now?: Date): string`, `type Activity` from `src/ics.ts`.
- Produces: the deployed HTTP surface (`GET /`, `POST /generate`).

- [ ] **Step 1: Implement `src/index.ts`**

```ts
import { buildIcs, type Activity } from "./ics";

const ELSIE = "https://elsie.curtin.edu.au/api";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const PAGE = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Curtin timetable → calendar</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:26rem;margin:4rem auto;padding:0 1rem;line-height:1.5}
  label{display:block;margin-top:1rem}
  input{width:100%;padding:.5rem;margin-top:.25rem;box-sizing:border-box}
  button{margin-top:1.5rem;padding:.6rem 1.5rem;cursor:pointer}
  .error{color:#b00020}
  footer{margin-top:3rem;font-size:.85rem;color:#666}
</style>
<h1>Curtin timetable → calendar</h1>
<p>Enter your Curtin login to download your timetable as an <code>.ics</code>
calendar file, with classes as recurring events.</p>
{{error}}
<form method="post" action="/generate">
  <label>Curtin ID<input name="curtinId" required autocomplete="username"></label>
  <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
  <button>Download timetable.ics</button>
</form>
<p><strong>Privacy:</strong> your credentials are sent once to Elsie to fetch
your timetable and are never stored or logged.</p>
<footer>Inspired by <a href="https://github.com/JaciBrunning/ElsieScraper">ElsieScraper</a>.</footer>
</html>`;

function page(error = "", status = 200): Response {
  const body = PAGE.replace("{{error}}", error ? `<p class="error">${error}</p>` : "");
  return new Response(body, { status, headers: { "Content-Type": "text/html;charset=utf-8" } });
}

const badGateway = () => new Response("Elsie didn't respond as expected.", { status: 502 });

function elsieHeaders(): Record<string, string> {
  return { "User-Agent": UA, "X-Correlation-ID": crypto.randomUUID() };
}

async function generate(req: Request): Promise<Response> {
  const form = await req.formData();
  const curtinId = String(form.get("curtinId") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!curtinId || !password) return page("Please enter both your Curtin ID and password.", 400);

  let auth: { data?: { token?: string }; errors?: unknown };
  try {
    const res = await fetch(`${ELSIE}/sessions`, {
      method: "POST",
      headers: { ...elsieHeaders(), "Content-Type": "application/json;charset=UTF-8" },
      body: JSON.stringify({ curtinId, password }),
    });
    auth = await res.json();
  } catch {
    return badGateway();
  }
  const token = auth.data?.token;
  if (auth.errors || !token) return page("Login failed — check your Curtin ID and password.", 401);

  let activities: Activity[];
  try {
    const res = await fetch(`${ELSIE}/students/${encodeURIComponent(curtinId)}/study-activities`, {
      headers: { ...elsieHeaders(), Authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as { data?: Activity[] };
    if (!Array.isArray(json.data)) return badGateway();
    activities = json.data;
  } catch {
    return badGateway();
  }

  return new Response(buildIcs(activities), {
    headers: {
      "Content-Type": "text/calendar;charset=utf-8",
      "Content-Disposition": 'attachment; filename="timetable.ics"',
    },
  });
}

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") return page();
    if (req.method === "POST" && url.pathname === "/generate") return generate(req);
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler;
```

- [ ] **Step 2: Typecheck and run existing tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; 4 tests pass.

- [ ] **Step 3: Smoke-test locally**

Run: `npx wrangler dev` then in another shell:

```
curl -s http://localhost:8787/ | findstr "Curtin"
curl -s -o NUL -w "%{http_code}" -X POST http://localhost:8787/generate -d "curtinId=&password="
```

Expected: first prints HTML lines containing "Curtin"; second prints `400`.

- [ ] **Step 4: Verify against real Elsie (user in the loop)**

With `wrangler dev` still running, the user opens `http://localhost:8787/`,
enters their real credentials, and downloads the file. Verify:

- Login succeeds (if it fails with correct credentials, inspect the real
  `/sessions` response shape — the token path `data.token` and the
  `study-activities` path come from 2015-era ElsieScraper and may have
  drifted; adjust `generate()` to match reality and note the change in the
  spec).
- The .ics imports into a calendar app and classes appear as weekly
  recurring events at correct Perth times.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: worker routes — form page and /generate"
```

---

### Task 3: Deploy to timetable.harrys.monster

**Files:**
- None (deployment only).

**Interfaces:**
- Consumes: the Worker from Task 2 and `wrangler.jsonc` routing from Task 1.

- [ ] **Step 1: Authenticate wrangler (user in the loop)**

The user runs `npx wrangler login` in their own terminal (interactive OAuth).
`npx wrangler whoami` should then show the account that owns the
`harrys.monster` zone.

- [ ] **Step 2: Deploy**

Run: `npx wrangler deploy`
Expected: deploy succeeds and registers the custom domain
`timetable.harrys.monster` (wrangler creates the DNS record because
`custom_domain: true`).

- [ ] **Step 3: Verify production**

Run: `curl -s -o NUL -w "%{http_code}" https://timetable.harrys.monster/`
Expected: `200`. Then the user does one real end-to-end download on
production.

- [ ] **Step 4: Commit any final tweaks**

```bash
git add -A
git commit -m "chore: production deploy fixes" # only if anything changed
```
