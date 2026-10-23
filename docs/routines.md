# Routines

How GhostShell runs the routines that Claude Desktop runs, so Desktop does not have to stay open for them.

A routine is a prompt file that Desktop keeps, `~/.claude/scheduled-tasks/<id>/SKILL.md`, which GhostShell reads and never writes, and a schedule that GhostShell keeps in `routines.json` in its state folder. GhostShell has to be running when a routine is due, which is what the launchd agent under [Always on](always-on.md) is for. Routines show in the session list as [routine rows](session-list.md#routine-rows).

## Seeding

Desktop's own schedule file is internal to it and has no jitter in it, so you export the schedules once from Desktop to a JSON file with a `routines` list. Each entry has an `id`, `title`, `cron`, `jitterSeconds`, `file`, `cwd`, `model`, `effort`, `mode` and `enabledInDesktop`.

`npm run seed-routines -- <export.json>` copies them into `routines.json`, every one switched off, and prints when each would fire next. Run it again with a newer export to add routines that are new. It leaves the ones already there as they are, apart from `enabledInDesktop`.

GhostShell reads `routines.json` on every check, so a seed run or a hand edit shows without a restart. GhostShell writes the file too, so reload it before a hand edit.

## Switching over

A routine runs in GhostShell only once it is switched on here, so switch it off in Desktop first, or both apps run it. Switching on counts the schedule from that moment, so a fire time earlier in the day is not run on top of Desktop's own run.

## When it fires

The schedule is a five-field cron in the Mac's time zone, which GhostShell follows if it changes, with the routine's jitter added as a fixed offset, as Desktop does it: `30 7 * * 1-5` with 737 seconds of jitter fires at 07:42:17. GhostShell checks every 30 seconds, and once when it starts.

A routine that is due starts a new session in its folder with its permission mode, model and effort, on the [account](configuration.md#accounts) its `account` names in `routines.json` or else its folder's. The first message is Desktop's: the text of `SKILL.md` after its frontmatter, inside the same `<scheduled-task>` wrapper. GhostShell reads the file again at each run, so an edit applies at once.

## Missed runs

If GhostShell was not running at a fire time, the latest missed fire runs once as soon as GhostShell is up, provided it is under 12 hours late. GhostShell skips a later one and logs it. However many fires were missed, that is at most one run.

## One at a time

GhostShell skips and logs a fire that comes while the routine's previous run is still working. It does not hold the fire over until the run ends. GhostShell stops a previous run that is only waiting for an answer, and the new run starts in its place.

## Three at once

At most three routines run at the same time, as in Desktop, so fewer of them fight over one Chrome. A fourth that comes due waits for a free place, and starts as soon as one frees up. A run waiting for an answer does not take a place. Run now ignores the limit.

## Restarts

`routines.json` records when each routine was switched on and last ran, and GhostShell works out the next fire from that. A restart does not repeat a run, and GhostShell catches up a run that came due while it was down, as in [missed runs](#missed-runs). A restart can cut a run in progress short, and GhostShell does not start that run again. GhostShell records a run that cannot start in `lastError`, and it waits for the routine's next fire.

## A wrong file

GhostShell runs nothing in any of these cases:

- `routines.json` cannot be read.
- A routine has no id.
- An id appears twice, which is what a copied entry with its id left alone looks like.

`GET api/routines` says which, and GhostShell logs it once on stderr. An `enabled` that is not `true` or `false` counts as off.

## API

- `GET api/routines` lists the routines with their next fire time, whether each is running, and what is wrong with it if anything.
- `POST api/routines/<id>/run` runs one now, switched on or not, and answers 409 while its previous run is working.
- `POST api/routines/<id>/enabled` takes `{ "enabled": true }` or `false`.

## Logs

Every run, skip and switch is a line on stdout, and every run that fails to start is a line on stderr. Under launchd those are `out.log` and `err.log` in `~/Library/Logs/capcom/`.
