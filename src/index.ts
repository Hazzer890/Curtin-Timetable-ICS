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
