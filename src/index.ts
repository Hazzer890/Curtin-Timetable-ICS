import CLIENT from "./client.bundle.txt";
import { buildIcs, filterSemester, type Activity, type Semester } from "./ics";

const ELSIE = "https://elsie.curtin.edu.au/api";

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
  main{width:100%;max-width:26rem}
  .blocks{display:flex;gap:.375rem;margin-bottom:1.25rem}
  .blocks span{height:.5rem;border-radius:2px}
  .blocks span:nth-child(1){width:3.5rem;background:var(--gold)}
  .blocks span:nth-child(2){width:1.75rem;background:var(--b2)}
  .blocks span:nth-child(3){width:2.5rem;background:var(--b3)}
  .blocks span:nth-child(4){width:1.25rem;background:var(--b2)}
  h1{font-family:Georgia,'Times New Roman',serif;font-size:1.75rem;font-weight:600;margin:0 0 .5rem;letter-spacing:-.01em}
  .lede{color:var(--muted);margin:0 0 1.5rem}
  form,section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1.5rem}
  h2{font-family:Georgia,'Times New Roman',serif;font-size:1.1rem;margin:0 0 .5rem}
  section p{margin:0 0 1rem;font-size:.9rem}
  .bm{
    display:inline-block;font-weight:600;text-decoration:none;color:var(--ink);
    padding:.5rem .9rem;border:1px dashed var(--gold);border-radius:6px;background:var(--paper);
  }
  .step{color:var(--muted);font-size:.85rem;margin:.75rem 0 0}
  details{margin-top:1rem;font-size:.85rem}
  summary{cursor:pointer;color:var(--muted)}
  pre{
    max-height:8rem;overflow:auto;margin:.75rem 0 .5rem;padding:.6rem;font-size:.7rem;
    background:var(--paper);border:1px solid var(--line);border-radius:6px;white-space:pre-wrap;word-break:break-all;
  }
  #copy{width:auto;padding:.4rem .8rem;font-size:.85rem}
  .divider{color:var(--muted);font-size:.85rem;text-align:center;margin:1.5rem 0 1rem}
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
  <section>
    <h2>Without a password</h2>
    <p>This runs on Elsie's own page, using the login you already have there.
    Nothing is sent to this site — not your password, not your timetable.</p>
    <a class="bm" href="{{bookmarklet}}">Curtin&nbsp;→&nbsp;.ics</a>
    <p class="step">Drag that to your bookmarks bar. Then open
    <a href="https://elsie.curtin.edu.au">elsie.curtin.edu.au</a>, log in, and click it.</p>
    <details>
      <summary>Bookmarks bar hidden? Paste this into the console instead</summary>
      <p class="step">On Elsie, press F12 → Console, paste, press Enter.</p>
      <pre id="snip">{{snippet}}</pre>
      <button type="button" id="copy">Copy</button>
    </details>
  </section>
  <p class="divider">or, on a phone, hand over your login</p>
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
  <p class="note">Bookmarklets don't work in most mobile browsers, so the form is here as a fallback.
  Your login passes through this site once to reach Elsie. Nothing is stored or logged —
  but you have to take my word for that, which is why the option above exists.</p>
  <footer>Not affiliated with Curtin University.</footer>
</main>
<script>
  copy.onclick = () => navigator.clipboard.writeText(snip.textContent).then(() => copy.textContent = "Copied");
</script>
</html>`;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function page(error = "", status = 200): Response {
  const body = PAGE.replace("{{error}}", error ? `<p class="error">${esc(error)}</p>` : "")
    // encodeURIComponent already escapes <, >, " and &, so the href is attribute-safe.
    .replace("{{bookmarklet}}", `javascript:${encodeURIComponent(CLIENT)}`)
    .replace("{{snippet}}", esc(CLIENT));
  return new Response(body, { status, headers: { "Content-Type": "text/html;charset=utf-8" } });
}

const badGateway = () => new Response("Elsie didn't respond as expected.", { status: 502 });

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
      headers: { "Content-Type": "application/json;charset=UTF-8" },
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
      headers: { Authorization: `Bearer ${token}` },
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
