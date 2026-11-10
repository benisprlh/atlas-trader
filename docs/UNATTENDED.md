# Unattended paper updater

Process one current hourly paper cycle even while the browser is closed. Never
send financial transactions, grant wallet access, or change strategy settings.

1. Obtain current Site metadata using the exact project ID in `.openai/hosting.json`.
   Confirm owner-private access has been preserved.
2. Use supported Site service access to POST `{}` to `/api/scheduled-tick`.
   Put its scoped bearer only in `OAI-Sites-Authorization` for this Site. Never
   print, log, save or include it in a schedule prompt.
3. Read `/api/state` with that same access. Verify `schedule.lastHeartbeat`
   advanced; inspect `session.lastTick`, `session.error` and last processed candle.
4. A missing or paused session is a valid no-trade outcome. Do not start, reset
   or resume it in a recurring run.
5. Repeated calls are candle-idempotent. Retry a revision conflict once after a
   fresh read. Surface provider errors; never substitute sample prices silently.
6. Routine runs update the dashboard. Notify only when blocked or errors persist.

Cadence: hourly shortly after the hour in Asia/Jakarta. Delays are possible;
this is a research scheduler rather than a guaranteed execution service.

Source access and writer authorization are independent. A future task must get
fresh supported access. Do not make the Site public to access the updater.
