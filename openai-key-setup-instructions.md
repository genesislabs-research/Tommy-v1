# OpenAI API Key Setup

Find the exact env var name the app expects for OpenAI — grep for "OPENAI" across
the donor source and vite.config.js (check whether it's read server-side via
process.env or needs a VITE_ prefix for the build).

Then:

1. Create `%DEPLOY%\.env` with a placeholder line, e.g. `OPENAI_API_KEY=REPLACE_ME`
   (use whatever the real var name turns out to be).

2. Add `.env` to `.gitignore` in both the deploy and donor directories so it
   never gets committed or pushed.

3. Edit Start-Ghost.bat to load that `.env` file into the environment before
   launching the server — loop through its lines and `set` each one, or
   whatever fits how start-ghost.ps1 already spins up the node process.
   Confirm the key actually reaches the running server process, not just the
   batch file's own shell.

4. Add a final step to Start-Ghost.bat that runs
   `explorer /select,"%DEPLOY%\.env"` to pop a File Explorer window with the
   `.env` file already highlighted, so I can just double-click it, paste my
   real key into Notepad over the placeholder, and save.

Don't ask where the file is or tell me the path — just make it open
automatically.
