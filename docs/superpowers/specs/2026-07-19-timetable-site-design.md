# timetable.harrys.monster — Design

2026-07-19. Inspired by [ElsieScraper](https://github.com/JaciBrunning/ElsieScraper).

## Purpose

A hosted service where Curtin students enter their Elsie credentials and get back
their timetable as an `.ics` file, with classes as **recurring events** rather than
one event per session. One-time download; credentials are never stored.

## Architecture

A single Cloudflare Worker on the `harrys.monster` zone, routed to
`timetable.harrys.monster`. TypeScript, deployed with wrangler. Stateless: no KV,
no D1, no logging of credentials or timetable data. No frontend framework or
build step — the page is inline HTML in the Worker.

## Elsie API (from ElsieScraper)

- `POST https://elsie.curtin.edu.au/api/sessions` with JSON
  `{ curtinId, password }` → JSON containing a bearer token (or errors).
- `GET https://elsie.curtin.edu.au/api/students/{curtinId}/study-activities`
  with `Authorization: Bearer <token>` → JSON `data` array of activities:
  `startDateTime`, `endDateTime`, `unit { unitCode, abbreviatedTitle }`,
  `activityType`, `location { buildingNumber, roomNumber, name }`.
- Open item (resolve during dev with real credentials): whether
  `study-activities` accepts date-range params. If it only returns the current
  study period, that is acceptable for v1.

## Routes

- `GET /` — inline HTML form: Curtin ID + password + semester select
  (All / Semester 1 / Semester 2, filtered by start-month window Jan–Jun vs
  Jul–Dec), a privacy note ("credentials are sent once to Elsie and never
  stored or logged"), and a "not affiliated with Curtin University" footer.
  No reference to the project that inspired it.
- `POST /generate` — form-encoded body → login → fetch activities → build ICS →
  `200` with `Content-Type: text/calendar` and
  `Content-Disposition: attachment; filename="timetable.ics"`.

The Worker proxy is mandatory: browsers cannot call the Elsie API directly (CORS).

## ICS generation

Pure function: activities JSON in → ICS text out.

1. Group activities by `(unitCode, activityType, weekday, startTime, endTime,
   location)`.
2. A group with ≥2 occurrences at exact weekly spacing (allowing gap weeks)
   becomes one `VEVENT`:
   - `DTSTART;TZID=Australia/Perth:<first occurrence>`
   - `RRULE:FREQ=WEEKLY;UNTIL=<last occurrence, UTC>`
   - `EXDATE;TZID=Australia/Perth:` for each missing week in between
     (tuition-free week).
3. Groups of one, or with irregular spacing, emit singular events.
4. `SUMMARY`: `"<unitCode> <abbreviatedTitle> — <activityType>"`.
   `LOCATION`: `"<buildingNumber>.<roomNumber> (<name>)"`.
5. Embed a `VTIMEZONE` for `Australia/Perth` (no DST) so RRULEs render
   correctly across calendar clients.

## Error handling

- Bad credentials (Elsie 401 / error payload): re-render the form with a
  friendly message.
- Elsie unreachable or response shape unexpected: `502` "Elsie didn't respond
  as expected".
- Never include stack traces, request bodies, or credentials in responses or
  logs.

## Testing

- One unit test file for the ICS builder using an anonymized fixture built from
  a real `study-activities` response. Cases: weekly collapse, EXDATE for a gap
  week, fallback to singular event.
- Manual end-to-end check with real credentials before deploy.

## Out of scope (v1)

Subscription/webcal URLs, credential storage, multiple study periods, styling
beyond a minimal clean page.
