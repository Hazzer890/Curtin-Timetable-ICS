// Runs on https://elsie.curtin.edu.au itself: same-origin, so it reuses the
// session the student already has. No password, and no request to our Worker.
import { buildIcs, filterSemester, type Activity, type Semester } from "./ics";

// This tsconfig has no DOM lib — it conflicts with @cloudflare/workers-types — so
// declare the few browser globals this payload uses.
declare const angular: { element(e: unknown): { injector(): { get(n: string): { current(): RawSession } } } };
declare const document: { body: unknown; createElement(tag: "a"): { href: string; download: string; click(): void } };
declare const localStorage: { length: number; key(i: number): string | null; getItem(k: string): string | null };
declare const alert: (message: string) => void;
declare const prompt: (message: string, fallback?: string) => string | null;

interface RawSession {
  accessToken?: string;
  token?: string;
  curtinId?: string;
  studentId?: string;
  id?: string;
}

function fromAngular(): RawSession | null {
  try {
    return angular.element(document.body).injector().get("SessionService").current() ?? null;
  } catch {
    return null;
  }
}

// SessionService persists via `$save` -> localStorage["__cache_<name>"], keyed "elsie-user".
function fromCache(): RawSession | null {
  if (typeof localStorage === "undefined") return null;
  const ls = localStorage;
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i);
    if (!key?.startsWith("__cache_")) continue;
    try {
      const user = JSON.parse(ls.getItem(key) ?? "")?.["elsie-user"];
      if (user?.accessToken || user?.token) return user;
    } catch {
      // not ours; keep looking
    }
  }
  return null;
}

function subClaim(token: string): string | null {
  try {
    return JSON.parse(atob(token.split(".")[1])).sub ?? null;
  } catch {
    return null;
  }
}

export function findSession(): { token: string; id: string | null } | null {
  const raw = fromAngular() ?? fromCache();
  // The SPA middleware reads .accessToken, the sessions API returns .token — accept either.
  const token = raw?.accessToken ?? raw?.token;
  if (!token) return null;
  return { token, id: raw!.curtinId ?? raw!.studentId ?? raw!.id ?? subClaim(token) };
}

function download(ics: string): void {
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "timetable.ics";
  a.click();
  URL.revokeObjectURL(url);
}

async function main(): Promise<void> {
  const session = findSession();
  if (!session) {
    alert("Couldn't find an Elsie session. Log in at elsie.curtin.edu.au, then run this again from that tab.");
    return;
  }
  const semester = prompt("Which semester? all, s1 or s2", "all")?.trim().toLowerCase();
  if (!semester) return;
  const id = session.id ?? prompt("Your Curtin ID")?.trim();
  if (!id) return;

  const res = await fetch(`/api/students/${encodeURIComponent(id)}/study-activities`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  const json = (await res.json().catch(() => null)) as { data?: Activity[] } | null;
  if (!Array.isArray(json?.data)) {
    alert(`Elsie didn't return a timetable (HTTP ${res.status}). Try reloading the page and logging in again.`);
    return;
  }
  download(buildIcs(filterSemester(json.data, semester as Semester)));
}

// Guarded so importing this module in tests doesn't fire the whole flow.
if (typeof document !== "undefined") main().catch((e) => alert(`Timetable export failed: ${e}`));
