import { buildIcs, filterSemester, type Activity, type Semester } from "./ics";

const ELSIE = "https://elsie.curtin.edu.au/api";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const PAGE = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Curtin timetable → calendar</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' rx='3' fill='%23e8a417'/></svg>">
<style>
  :root{
    --paper:#faf9f6; --card:#ffffff; --ink:#1c1b1a; --muted:#6d6a64;
    --gold:#e8a417; --line:#e7e3da; --b2:#5b7c99; --b3:#87a07a;
  }
  @media (prefers-color-scheme:dark){
    :root{ --paper:#161513; --card:#201f1c; --ink:#f0eee9; --muted:#a09c93; --line:#37342e; }
  }
  *{box-sizing:border-box}
  body{
    font-family:ui-sans-serif,system-ui,sans-serif;
    background:var(--paper); color:var(--ink);
    margin:0; min-height:100vh; display:grid; place-items:center;
    padding:2rem 1rem; line-height:1.55;
  }
  main{width:100%;max-width:24rem}
  .blocks{display:flex;gap:.375rem;margin-bottom:1.25rem}
  .blocks span{height:.5rem;border-radius:2px}
  .blocks span:nth-child(1){width:3.5rem;background:var(--gold)}
  .blocks span:nth-child(2){width:1.75rem;background:var(--b2)}
  .blocks span:nth-child(3){width:2.5rem;background:var(--b3)}
  .blocks span:nth-child(4){width:1.25rem;background:var(--b2)}
  h1{font-family:Georgia,'Times New Roman',serif;font-size:1.75rem;font-weight:600;margin:0 0 .5rem;letter-spacing:-.01em}
  .lede{color:var(--muted);margin:0 0 1.5rem}
  form{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1.5rem}
  label{display:block;font-size:.85rem;font-weight:600;margin-bottom:1rem}
  input,select{
    width:100%;font:inherit;color:inherit;margin-top:.3rem;padding:.55rem .65rem;
    background:var(--paper);border:1px solid var(--line);border-radius:6px;
  }
  input:focus-visible,select:focus-visible,button:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
  button{
    width:100%;font:inherit;font-weight:600;cursor:pointer;margin-top:.25rem;
    padding:.65rem;border:none;border-radius:6px;background:var(--ink);color:var(--paper);
  }
  .error{color:#d64545;font-size:.9rem;margin:0 0 1rem}
  .note{color:var(--muted);font-size:.85rem;margin-top:1.25rem}
  footer{color:var(--muted);font-size:.8rem;margin-top:2rem}
</style>
<main>
  <div class="blocks" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
  <h1>Download your Curtin classes as a calendar file</h1>
  <p class="lede">Data is taken from Elsie.</p>
  {{error}}
  <form method="post" action="/generate">
    <label>Curtin ID<input name="curtinId" required autocomplete="username"></label>
    <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
    <label>Semester
      <select name="semester">
        <option value="all">Whole year (Feb – Nov)</option>
        <option value="s1">Semester 1 (Feb – Jun)</option>
        <option value="s2">Semester 2 (Jul – Nov)</option>
      </select>
    </label>
    <button>Download timetable.ics</button>
  </form>
  <p class="note">Your login goes to Elsie once to fetch your timetable.
  Nothing is stored or logged.</p>
  <footer>Not affiliated with Curtin University.</footer>
</main>
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
  const semester = String(form.get("semester") ?? "all") as Semester;
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

  return new Response(buildIcs(filterSemester(activities, semester)), {
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
