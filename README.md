# Graph Canvas

Graph Canvas 2.0 is a terminal simulator for synthetic Git contribution calendars. Pick a date range, timezone, seed and commit count to preview a pattern. If you approve it, Graph Canvas creates dated commits in an isolated clone of your dedicated private repository. You decide separately whether to push them.

Each commit carries the subject `chore: generate synthetic calendar entry`, a run identifier and an entry number. The commits record simulated activity. Describe them as synthetic when sharing a calendar or discussing your development history.

## First-time installation

You will use two repositories. A *repository* is a project folder with a history of its changes.

| Repository | What you do with it |
| --- | --- |
| `thesamtom/graph-canvas-pub` (public) | Download the Graph Canvas program from here and run it on your computer. |
| `YOUR-USERNAME/calendar-sandbox` (private) | Create this on your GitHub account. Paste **this repository's URL** when the wizard asks where to put synthetic commits. |

Follow the steps in order on your first run. If you already downloaded Graph Canvas, keep your existing folder and skip the `git clone` step.

### 1. Install the three tools

Open **PowerShell** from the Start menu on Windows, or **Terminal** on macOS or Linux. Enter commands one line at a time and press **Enter** after each line.

| Tool | Why Graph Canvas uses it | Installation |
| --- | --- | --- |
| Node.js and npm | Node runs the program. npm installs its dependencies. | Choose an LTS release **22 or newer** from the [Node.js downloads page](https://nodejs.org/en/download). |
| Git (`git`) | Downloads repositories and creates local commits. | Select your operating system on the [Git installation page](https://git-scm.com/downloads). |
| GitHub CLI (`gh`) | Signs your terminal into GitHub so Graph Canvas can check a private repository. | Windows users can run `winget install --id GitHub.cli --exact`. On macOS with Homebrew, run `brew install gh`. For other installers and Linux instructions, use the [GitHub CLI installation page](https://cli.github.com/). |

Close and reopen your terminal after installing. Run these checks. Each command should print a version, and the first should start with `v22` or higher.

```sh
node --version
npm --version
git --version
gh --version
```

If a command says "not recognized" or "command not found," install the matching tool from the table and open a new terminal. If PowerShell blocks `npm.ps1`, use `npm.cmd` in place of `npm` throughout this guide.

### 2. Create your private repository in the browser

1. Sign in to GitHub. If you are new, [create an account](https://github.com/signup) and complete GitHub's email verification.
2. Open the [new repository form](https://github.com/new). Choose your own username under **Owner** and enter **calendar-sandbox** as the repository name.
3. Choose **Private**, turn on **Add a README file** so you have a starting branch, and click **Create repository**.
4. On your new repository's page, click **Code**, choose **HTTPS**, and copy the URL. It will look like `https://github.com/YOUR-USERNAME/calendar-sandbox.git`. Keep it handy for the wizard.

Already have a dedicated private repository? Copy its HTTPS URL and use its actual owner and name in the remaining steps. [GitHub's repository creation guide](https://docs.github.com/en/repositories/creating-and-managing-repositories/quickstart-for-repositories)

### 3. Sign your terminal into GitHub

Signing in on the GitHub website gives your **browser** access. This next step gives the **terminal** access. You can run it from any folder.

```sh
gh auth login --hostname github.com --web
```

1. If asked for a Git protocol, choose **HTTPS**.
2. If asked **Authenticate Git with your GitHub credentials?**, choose **Yes**. This lets Git use your sign-in when the wizard clones or pushes.
3. When the terminal displays a one-time device code, press **Enter** to open GitHub in your browser. Enter the code from **your own terminal** on GitHub's device sign-in page and authorize GitHub CLI. Keep the code private.
4. Return to the terminal. Wait for **Logged in as** and check that it shows the account that owns your private repository. [GitHub CLI sign-in reference](https://cli.github.com/manual/gh_auth_login)

### 4. Verify access before starting the wizard

Replace `YOUR-USERNAME` with the GitHub username shown in Step 3. If you chose a different repository name, replace `calendar-sandbox` too.

```sh
gh auth status --hostname github.com
gh repo view YOUR-USERNAME/calendar-sandbox --json visibility,viewerPermission
```

For a private repository you own, the second command should return values like these (the field order can vary).

```json
{
  "viewerPermission": "ADMIN",
  "visibility": "PRIVATE"
}
```

**PRIVATE** plus **ADMIN**, **MAINTAIN**, or **WRITE** means your signed-in account has the access the wizard needs. If this check fails, use the table below before retrying the wizard.

| What you see | What to do |
| --- | --- |
| GitHub says you are not logged in | Complete Step 3, including browser authorization, then rerun both checks. |
| The active account is different | Run `gh auth switch --hostname github.com` if the correct account is already saved, or use Step 3 to sign it in. |
| Repository not found, or GitHub cannot verify access | Open the private repository in your browser. Compare its owner and name with the command, verify the terminal account, and check your connection. |
| `PUBLIC`, `READ`, or `TRIAGE` | Choose a dedicated private repository you own or have permission to write to. |
| The wizard keeps asking for the URL | Press **Enter** at **Return to repository setup? (y/N)** to exit. Run the two commands above in that same terminal. Retrying different URL formats repeats the same GitHub account check. |

### 5. Download and launch Graph Canvas

From a folder where you keep projects, run:

```sh
git clone https://github.com/thesamtom/graph-canvas-pub.git
cd graph-canvas-pub
npm ci
npm start
```

If you already downloaded the program, open a terminal **inside the folder containing `package.json`** and run the last two commands. `npm ci` installs the versioned dependencies. On later visits, open the same folder and run `npm start`.

When you see **Private GitHub repository URL**, paste the HTTPS URL you copied in Step 2. If the wizard has no Git identity to suggest, enter your name and an email associated with your GitHub account. You can find your GitHub-provided noreply address in [GitHub email settings](https://github.com/settings/emails).

**Want to see a calendar first?** After `npm ci`, run the following from the application folder. This offline preview needs only Node.js, npm and Git. It displays a schedule without connecting to GitHub or creating commits.

```sh
node index.js generate --dry-run --start 2024-02-28 --end 2024-03-01 --timezone UTC --total 4
```

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
