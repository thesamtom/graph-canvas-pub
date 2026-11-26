# Graph Canvas

Graph Canvas 2.0 is a terminal simulator for synthetic Git contribution calendars. Pick a date range, timezone, seed and commit count to preview a pattern. If you approve it, Graph Canvas creates dated commits in an isolated clone of your dedicated private repository. You decide separately whether to push them.

Each commit carries the subject `chore: generate synthetic calendar entry`, a run identifier and an entry number. The commits record simulated activity. Describe them as synthetic when sharing a calendar or discussing your development history.

## Prerequisites

Use a terminal on Windows, macOS or Linux. Install Node.js 22 or newer with npm and Git. For a repository-backed preview, generation or push, also install GitHub CLI (`gh`). An offline preview only needs Node, npm and Git.

Repository-backed runs also require a GitHub account, Git authentication, and a dedicated private repository you can write to.

## Quick start

```sh
git clone https://github.com/thesamtom/graph-canvas-pub.git
cd graph-canvas-pub
npm ci
npm start
```

The source checkout needs a writable directory for its local workspace. On Windows, `npm.cmd` works in PowerShell environments that restrict npm’s script shim.

## Prepare your private repository

1. Sign in to GitHub.com. Choose **New repository**, enter a name, and create a **private** repository solely for simulated activity. An empty repository works. You can also initialize it with a README. Keep Graph Canvas installed in its own source checkout.
2. Run `gh auth login --hostname github.com` and use the GitHub CLI sign-in flow. Use `gh auth status --hostname github.com` to check which account is active. The account needs write access to the target.
3. For HTTPS, use an existing Git credential manager or run `gh auth setup-git` yourself to use your GitHub CLI login for Git. For SSH, configure a key that GitHub recognizes. Authentication for Git and authentication for the GitHub API must both work.
4. Copy the repository’s HTTPS or SSH clone URL. Graph Canvas accepts forms such as `https://github.com/OWNER/REPO.git`, `git@github.com:OWNER/REPO.git`, and `ssh://git@github.com/OWNER/REPO.git`. Supply a plain URL without a password or embedded token.

Graph Canvas checks private visibility, repository identity and write permission using authenticated GitHub metadata. An unavailable check stops repository-backed generation. Git also checks transport access. The source repository and recognized source remotes are excluded. Generated commits go into a clone under the ignored `workspace/` directory. The completion summary prints its full path.

## Walk through a simulation

1. Start `npm start` in an interactive terminal. The wizard checks Node and Git and asks for your dedicated repository URL.
2. Review the detected author name and email or enter your own. Choose an email associated with your GitHub account, including a GitHub-provided noreply address. Identity overrides apply only to each generated commit.
3. Enter both dates as `YYYY-MM-DD`. Both endpoints count. The wizard detects the system timezone and accepts an IANA name such as `America/New_York`, `Europe/London`, or `Asia/Kolkata`.
4. Choose the number of **new** commits and a seed. The planner spreads activity across busier and quieter stretches, favors weekdays, and reduces or omits breaks for short ranges. A small total can occupy just one date.
5. Inspect the repository, branch, author, range, seed, ledger count and new activity in the preview. Type **e** to edit, **r** to preview the next seed, or **y** to create the displayed commits locally. Enter cancels. The target clone can exist after a preview or cancellation.
6. Follow the completed count, percentage, elapsed time and estimated time remaining. After local generation, a second prompt names the push destination. Enter keeps the commits local. Type **y** to push.
7. Read the summary for the run ID, branch, local path and remote status. GitHub controls contribution eligibility and display. Private activity visibility depends on your profile settings. A successful push confirms delivery of Git history. Profile updates are outside the simulator.

### Illustrative terminal session

This shortened example shows a leap-day simulation. The user accepts two local commits and presses Enter at the push prompt.

```text
Private GitHub repository URL > https://github.com/example/calendar-sandbox.git
First date (YYYY-MM-DD) > 2024-02-29
Last date (inclusive) > 2024-02-29
IANA timezone > UTC
Number of new synthetic commits > 2
Simulation seed > 42

SYNTHETIC CONTRIBUTION PREVIEW
Repository       example/calendar-sandbox
Date range       2024-02-29 through 2024-02-29 (1 days)
Timezone         UTC     Seed  42
Existing ledger  0 entries (0 in range)
New commits      2     Active dates  1     Inactive dates  0

Sun
Mon
Tue
Wed
Thu  #
Fri
Sat

Add 2 local synthetic commits to example/calendar-sandbox? [y] generate / [e] edit / [r] new seed / [N] cancel > y
[====================] 100%  2/2  Elapsed 2s  ETA 0s
Push these synthetic commits to example/calendar-sandbox / main? (y/N) >

GRAPH CANVAS   /   Run summary
Repository     example/calendar-sandbox
Branch         main
Local commits  2 / 2
Run status     completed-locally
Remote status  Push unconfirmed
```

## Dates, capacity and preview symbols

A run supports **1–1,827 inclusive calendar dates**, **1–10,000 new commits**, and a seed between **0 and 4,294,967,295**. Actual capacity may be lower. The planner uses distinct available seconds between 09:00 and 22:00 in the selected timezone. Today ends at the fixed planner clock. Times before the Unix epoch have zero capacity. A selected weekend day allows up to two entries including existing ledger activity. Gaps, repeated local times and leap days follow the timezone data shipped with Node. The preview may display a canonical timezone alias.

The preview uses Sunday–Saturday rows, wraps long ranges into dated panels, and scales intensity relative to the busiest newly planned day. A dot means zero new entries. The symbols `:`, `o`, `O`, and `#` indicate increasing activity. Spaces outside the selected range are padding. The summary counts existing ledger activity separately. These records cover the target ledger only. Capable terminals add green tones, and setting `NO_COLOR` disables them.

## Commands and automation

```sh
node index.js --help
node index.js --version
node index.js generate
node index.js generate --dry-run
node index.js generate --dry-run --start 2024-02-01 --end 2024-02-29 --timezone Europe/London --total 50 --seed 17
node index.js status --repo https://github.com/OWNER/REPO.git
node index.js resume --repo https://github.com/OWNER/REPO.git
```

A dry run without `--repo` uses an empty ledger and works offline. To preview actual ledger activity, add `--repo URL`. Use `--name` and `--email` when Git has no suitable configured identity. A repository-backed dry run prints an approval digest and an ISO clock. To approve in automation, repeat the same command and options, replacing `--dry-run` with the printed `--yes --approve DIGEST --clock ISO` arguments. The digest binds the repository, starting history, author and exact schedule to that preview. Changes require a fresh preview.

For a partial run, `node index.js resume --repo URL --yes` confirms local continuation. For a locally completed run, `node index.js resume --repo URL --push` confirms a separate push. Use the same repository URL form when returning to an existing workspace. In a terminal, bare `status` and `resume` prompt for the repository URL.

The CLI still accepts `--total` and `--seed`. Without explicit dates, a dry run defaults to the last 365 days through today, 1,066 commits and seed 42. In 2.0, dates use your system zone by default, write operations require a separate private target, and `--yes` alone cannot launch a new unattended run. Scheduled timestamps can differ from version 1 for the same seed.

## History, local storage and recovery

Graph Canvas appends entries to `graph-canvas-ledger.json` in the target. The ledger groups timestamps by run. Graph Canvas validates its format, checks for collisions and rejects a duplicate range, timezone, total and seed already recorded in the v2 ledger.

Graph Canvas can also recognize an original version 1 ledger. It reads tracked `data.json` files up to 4 MiB and checks each timestamp against the file’s Git history, including the old commit subjects, author and committer times, and changed paths. Confirmed entries reserve timestamps in the new plan. Other application data stays outside the simulation.

An approved plan lives in `.git/graph-canvas-run.json` **inside the target clone**. It records the schedule, fixed clock, identity, starting history, progress and status. An exclusive lock prevents simultaneous writers. Keep this workspace between sessions. A fresh clone of the target contains pushed ledger history, while the local checkpoint stays with the workspace where generation began.

- **Stop during generation.** Press Ctrl+C once and wait for the current operation to finish. Run `status`, then `resume` with the same target. Recovery checks the approved branch, ledger, commit metadata and checkpoint before continuing.
- **Keep commits local.** Decline the push. You can reopen the run later with `resume`. Each workspace manages one outstanding run at a time. Complete its push before approving another generation there.
- **Retry a push.** Correct your network, credentials or branch permissions, then use `resume`. Graph Canvas rechecks the destination, branch history and remote tip. It uses an ordinary push of the verified commit. A changed remote or unrelated outgoing commit requires inspection.
- **Handle a stale lock.** Look inside the target clone’s `.git/graph-canvas.lock` for the process ID. Only after verifying that process has stopped, remove that specific lock and use `resume`. Keep the saved run file and ledger.
- **Resolve a validation error.** Inspect `git status` in the target clone. Finish an in-progress merge or rebase, review staged files, and resolve ledger conflicts or branch changes before resuming. Avoid changing branches or using the target clone for other work during generation.

## Troubleshooting

| Message or symptom | What to check |
| --- | --- |
| Wizard requires a terminal | Start it in a terminal window. Use `--dry-run` or the two-step approval workflow for scripts. |
| Node, Git or GitHub CLI missing | Check `node --version`, `git --version`, and `gh --version`. Reopen the terminal after installing a tool. |
| Cannot verify access or visibility | Check `gh auth status`, the repository spelling, private visibility, write permission, and connectivity. Use a dedicated active repository on github.com. |
| Git transport fails after GitHub login | Verify your HTTPS credential helper or SSH key for the URL you entered. A protected branch may reject a push even when the account has write access. |
| Invalid date, timezone or capacity | Enter a real date, check today in the selected zone, and shorten the range or reduce the total as indicated. For a larger total, include more available weekdays. |
| Duplicate run or saved run exists | Inspect `status`. Resume pending work. For a genuinely different simulation, preview different settings. |
| Profile graph differs from the preview | The preview shows planned activity. Review GitHub’s email attribution, eligible branch and private contribution settings. |

## Frequently asked questions

**Can I try it before connecting GitHub?** Run `node index.js generate --dry-run` for an offline preview.

**Where do the commits go?** They go into the isolated target clone. The wizard shows the destination and asks separately before pushing.

**Will my profile match the preview?** GitHub determines eligibility and visibility. The preview counts newly planned synthetic entries for one repository.

## Known limitations

Repository-backed runs support private repositories on github.com and require authenticated GitHub CLI. Each target workspace supports one outstanding run. Keep the local clone to retain recovery progress.

## Security and privacy

Use a target you trust and are authorized to modify. Git uses the credentials already configured on your machine. Graph Canvas stores the selected author identity and calendar metadata locally and in Git commits. Keep credentials out of URLs, logs and bug reports. Treat the ignored workspace as local repository data when backing up or sharing the source checkout.

## Project architecture

The CLI entry point is `index.js`. Calendar selection and seeded scheduling live in `plan.js` and `src/calendar.js`. Terminal interaction and rendering live in `src/wizard.js`, `src/terminal.js`, and `src/preview.js`. Repository validation lives in `src/repository.js`. Commit execution and recovery use `commits.js` and `src/storage.js`.

## Contributing

For a contribution, describe the expected behavior and a reproducible example. Use a fixed clock and seed for planner changes and a temporary local bare remote for Git changes. Run `npm ci` and `npm test` before proposing the change. Tests use Node’s built-in runner. The project is distributed under the [MIT License](LICENSE).
