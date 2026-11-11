# Battle test: simulate the use in your company

An app is not done when its tests pass. It has to work for the people of one
company: with their roles, their permission sets, and the tasks each of them
has. The battle test simulates exactly that. Agents that stand for those
people perform the process tests of the app step by step, each with the
permission sets and task groups of its roles, and the report says who gets
through, who is stopped where, and what the company needs that the app does
not cover.

```sh
bca simulate ./app                                    # result in the terminal, exit code 1 on failure
bca simulate ./app -o docs/simulation/README.md       # the report as documentation
bca simulate ./app --format json                      # the same as data
```

One run is three things at once:

| It is | What you get |
| --- | --- |
| An **automatic test** | `bca simulate` fails CI when an agent cannot complete a task it is assigned, or can complete one it must not. It reads the source, so it runs in seconds, without a container or a license. |
| A **process test** | Every use case is checked from start to end across roles: who performs each step, where the process stops, which steps wait for one before them. |
| A **metadata object** | The JSON report carries everything the run found. The Markdown documentation, the explanation of every permission a step needs, and the fit-gap analysis are written from it. |

[Example report](../examples/simulation/README.md) for the purchasing example
(`examples/purchasing-app`): a team lead who cannot approve because a
subscriber's codeunit is missing in the permission set, an administrator who
can approve although the company forbids it, and two requirements the app does
not cover.

## Process tests

A process test is an AL UI test with a `// [SCENARIO]` comment, the same test
[the user guides are written from](./al-ui-test-documentation.md). Its
`TestPage` calls are the steps: open a page, enter a value, choose an action.
`[FEATURE]` groups scenarios into use cases, `[NEXT]` and `[REQUIRES]` give
their order, and `[PERMISSIONS]` names the permission sets the test expects to
be enough.

```al
// [DOC-ID] purchase-request-approve
// [FEATURE] purchase-requests
// [SCENARIO] Approve a released purchase request.
// [PERMISSIONS] PR - APPROVE
// [WHEN] The approver chooses Approve on the purchase request.
PurchaseRequests.OpenEdit();
PurchaseRequests.GoToRecord(PurchaseRequest);
PurchaseRequests.Approve.Invoke();
// [REQUIRES] purchase-request-release
```

`bca simulate` looks for them in `--tests`, then `simulation.tests`, then
`docs.tests` in `.bca.json`, then in the app folder itself.

## What a step needs

For every step, BC Atlas follows the code behind it and collects what the
person who performs it needs:

| Step | Needs |
| --- | --- |
| Open a page | Execute on the page, Read on its source table, and what `OnOpenPage` and the other page triggers run. |
| Create a record, add a line | Insert on the source table, and what `OnInsert` and `OnNewRecord` run. |
| Enter a value | Modify on the source table, and what the `OnValidate` triggers of the page field and the table field run. |
| Choose an action | What its trigger runs: Execute on every codeunit, page, or report it calls or runs (`Codeunit.Run`, `Page.Run`, `RunObject`), and the table-data right for every table that code reads, inserts, modifies, or deletes. |
| Anything that raises an event | Execute on the codeunits that subscribe to it, and what the subscribers run: integration and business events, the database events of tables (`OnAfterInsertEvent`), and the trigger events of pages (`OnOpenPageEvent`, `OnAfterActionEvent` of the action, `OnAfterValidateEvent` of the field). This is the permission that is forgotten most often. |

The report lists each need with its reason, so nobody has to guess why a role
needs a permission:

```text
Execute on codeunit 50222 Request Notifications
  it subscribes to OnAfterApproveRequest of codeunit 50220 Purchase Request Mgt. (NotifyRequester)
Insert on table 50202 Request Approval Entry
  codeunit 50220 Purchase Request Mgt. (LogApproval) runs Insert
```

### How it decides

- An agent has the permission sets of its roles and its own, with every set
  they include (`IncludedPermissionSets`, permission set extensions) and
  without those they exclude (`ExcludedPermissionSets`). `tabledata * = R`
  and `codeunit * = X` count for every object of that type.
- An indirect permission (a lowercase letter, `ri`) is enough when the code
  that uses it has the permission itself: the `Permissions` property of the
  object, or of an object that calls it. Indirect Execute is enough for
  objects that code runs, not for the page a user opens.
  `InherentPermissions` grant a right to everyone.
- Temporary records and tables with `TableType = Temporary` need nothing;
  what their triggers run does.
- A process test that is blocked counts as reached when an `[ALTERNATIVE]`
  to it works: the steps after it do not wait, and the requirement fits.
- The steps are the clicks of the `[WHEN]` phases. A page they work on that
  the test opened under `[GIVEN]` is opened first.
- Every statement counts, whatever condition guards it. A step needs what its
  code can do, not only what it does with today's data.
- A permission set that is not part of the analyzed source (for example
  `D365 BASIC`) grants nothing on objects of the analyzed apps. Sets named in
  `simulation.fullAccess` (default `SUPER`) grant everything.
- Objects of other apps (the Base Application, any symbol package): a right
  that the analyzed permission sets do not grant is assumed to come with that
  app's own permission sets, and the agent's card lists what was assumed.
  With `"otherApps": "check"` such a right is required like any other. Where
  a permission set outside the source may grant it, the step is reported as
  **not verifiable** instead of blocked. Members that your page extensions
  add to pages of other apps are traced either way.
- Interface calls, objects chosen at run time, and manually bound subscribers
  are not followed. The report names them under the step.

The battle test reads the source; it does not run the app. It finds what a
role cannot do for lack of permissions. Errors in the logic or the data are
what the AL test itself proves when it runs.

## Describe your company

Without further settings, the process tests describe the company themselves:
every combination of `[PERMISSIONS]` is a role that performs the tests naming
it. That alone checks a promise nothing else checks: that the permission sets
a test names are enough for what its steps run.

To simulate your own company, describe it under `simulation` in `.bca.json`
(or in a file of its own, `--company company.json`):

```json
{
  "simulation": {
    "company": "Contoso GmbH",
    "tests": "test",
    "taskGroups": [
      { "name": "Requesting", "tasks": ["purchase-request-create", "purchase-request-release"] },
      { "name": "Approval", "tasks": ["purchase-request-approve"] },
      { "name": "Administration", "features": ["purchase-setup"] }
    ],
    "roles": [
      { "name": "Employee", "permissionSets": ["PR - REQUEST"], "taskGroups": ["Requesting"], "mustNot": ["Approval"] },
      { "name": "Team lead", "permissionSets": ["PR - REQUEST", "PR - APPROVE"], "taskGroups": ["Requesting", "Approval"] }
    ],
    "agents": [
      { "name": "Anna", "roles": ["Employee"] },
      { "name": "Ben", "roles": ["Team lead"] }
    ],
    "requirements": [
      { "id": "REQ-2", "title": "A team lead approves every request", "tasks": ["purchase-request-approve"] },
      { "id": "REQ-5", "title": "Audit can see who approved what", "objects": ["page:Request Approval Entries"] }
    ]
  }
}
```

| Setting | Meaning |
| --- | --- |
| `company` | Name of the company, for the title of the report. |
| `tests` | Folder with the process tests, relative to the app. |
| `taskGroups` | What there is to do: `name`, `description`, and the process tests by `tasks` (document IDs) or `features`. Without task groups, every `[FEATURE]` is one. |
| `roles` | Who does it: `name`, `description`, `permissionSets`, and the work as `taskGroups`, `tasks`, or `features`. `mustNot` lists what the role must not be able to do (process tests, features, or task groups): segregation of duties, tested. |
| `agents` | The people: `name` and `roles`, plus their own `permissionSets`, `taskGroups`, `tasks`, and `mustNot`. Without agents, there is one per role. |
| `requirements` | What the company needs, for the fit-gap analysis: `id`, `title`, `description`, the process tests that cover it (`tasks`, `features`), and `objects` of the app that should cover it (`page:Name`, `codeunit:Name`). Without requirements, every `[FEATURE]` is one. |
| `grounding` | Process tests grounded on recordings of Business Central: document ID of the test to the key or name of the recording. See [Grounding](#grounding-process-tests-on-recordings). |
| `fullAccess` | Permission sets that grant everything although they are not in the source. Default: `["SUPER"]`. |
| `otherApps` | Rights on objects of other apps that the analyzed permission sets do not grant: `assume` (default) takes them as given by that app's permission sets, `check` requires them. |
| `failOn` | Lowest severity that fails the battle test: `error` (default), `warning`, `info`, or `never`. |
| `language` | Language of the report: `en` (default) or `de`. |
| `outputDir` | Folder of the report that `bca run` writes. Default: `docs/simulation`. |

## Define the simulation

You do not have to write the `simulation` section by hand. The company is
changed by **operations**: add or change an agent, a role, a task group, or
a requirement, remove one, ground a process test on a recording. The same
operations come from three places, and each runs the changed simulation at
once:

| From | How |
| --- | --- |
| The view | **Simulate**, next to Story in the toolbar: the company, its agents and roles, and a form for each. The card of a person, a role, or a requirement on the graph has **Define…**, a process test **Ground…**. In VS Code a change is written to `.bca.json` and the graph shows the new result. An exported file is a snapshot: it collects the changes, saves them as `simulation-changes.json`, and `bca simulate define --from` applies them. |
| The terminal | [`bca simulate define`](./cli-reference.md#simulate-define): `--agent Ben --roles "Team lead"`, `--role ... --permission-sets ...`, `--remove agent:Dana`, `--dry-run`. Without options it shows the simulation as it is. |
| An agent | The MCP tool `bc_atlas_simulation_define` takes the operations as data and returns the definition and the result of the run. |

```json
[
  { "op": "set", "kind": "role", "name": "Team lead", "permissionSets": ["PR - REQUEST", "PR - APPROVE"], "taskGroups": ["Requesting", "Approval"], "mustNot": ["Ordering"] },
  { "op": "set", "kind": "agent", "name": "Ben", "roles": ["Team lead"] },
  { "op": "set", "kind": "requirement", "name": "REQ-2", "title": "A team lead approves every request", "tasks": ["purchase-request-approve"] },
  { "op": "ground", "task": "purchase-request-approve", "snapshot": "approve-a-released-purchase-request" },
  { "op": "remove", "kind": "agent", "name": "Dana" }
]
```

- `set` changes the fields it names and keeps the others; an empty list or
  text takes a field away.
- The first change of a project that defines nothing yet starts from the
  company the process tests describe, so no role is lost.
- The changed simulation runs before anything is written. A definition that
  is not valid never reaches `.bca.json`; `--dry-run` (`dryRun`) writes
  nothing at all.

That makes the loop short, for a person and for an agent: look at a finding,
change the company or a permission set, run again.

### The Simulation canvas

The lens **Simulation** of the view shows the definition and its result as
one picture: the people, the roles they have, the process tests each role
does (green) or must not do (red), who is blocked or can do what they must
not, the requirements the tests prove, and the recordings they stand on.
`bca view --lens simulation --form diagram -o simulation.svg` draws it
without a window.

### Grounding: process tests on recordings

A process test says what should happen. A **recording** of the same process
in Business Central (a fact snapshot of the [sync plugin](../plugins/sync/README.md))
says what did. A test is grounded on the recording that has its title, or on
the one `simulation.grounding` names:

```json
{ "simulation": { "grounding": { "purchase-request-approve": "approve-a-released-purchase-request" } } }
```

On the graph the recording points at the test (`grounds`), and the card of
the test says what it stands on. Where the two differ, the finding
`grounding-differs` names the objects: what ran in Business Central but the
test never touches, and what the test touches but the recording did not run
through. Documentation written from a grounded test stands on what really
ran.

## The report

**Who can do what.** Every agent tries every process test:

| | Meaning |
| --- | --- |
| ✅ | Assigned and completed. |
| ❌ | Assigned but blocked: an **error**, with the step, the missing permission, and the line to add to a permission set. |
| ❔ | Not verifiable from the analyzed source, whether assigned or forbidden. A forbidden task counts as denied only when a step is denied. |
| 🚫 | Must not, and is denied: the negative test passed. |
| ⚠️ | Must not, but can: an **error**. |
| ○ | Not assigned, but could do it. |
| – | Not assigned, and denied. |

**Processes.** Each use case with its steps in order, who performs them, and
its status: runs end to end, blocked, nobody assigned, or waiting for a step
before it. Handovers between roles are counted.

**Fit-gap analysis.** Each requirement against what the run showed:

| Status | Means | What to do |
| --- | --- | --- |
| Fit | Its process tests exist and an assigned agent completes each. | Nothing. |
| Gap: permissions | The function is there, but the assigned role is blocked. | Configuration: the report names the permission lines to add. |
| Gap: nobody assigned | The function is there, but no role has the task. | Organization: assign it. |
| Not proven: no process test | The objects named exist, but no process test covers them. | Write the `[SCENARIO]` UI test. |
| Gap: not in the app | No process test and no object covers it. | Development, or another solution. |

Below the table: pages users can search for that no process test opens, and
process tests no requirement asks for.

**Roles and agents.** One card per agent: permission sets with those they
include, task groups, each task with its outcome and what is missing, what
the agent could do without being assigned, the rights on objects of other
apps that were assumed, and the permissions no assigned task needs
(candidates to remove, for least privilege).

**Process tests and what they need.** Each test with its source, the
permission sets it names, and for every step what it needs and why.

### Findings

| Severity | Finding | Raised when |
| --- | --- | --- |
| error | `task-blocked` | An agent cannot complete an assigned process test. |
| error | `forbidden-task-possible` | An agent can complete a process test it must not. |
| error | `unknown-task`, `unknown-feature`, `unknown-task-group`, `unknown-role` | The `simulation` section names something that does not exist. |
| warning | `task-unstaffed`, `no-permissions-named` | Nobody is assigned a process test. |
| warning | `requirement-gap` | A requirement is not covered: no process test, nothing in the app, or nobody assigned. |
| warning | `unknown-permission-set` | A permission set is neither in the source nor in a symbol package. |
| warning | `assigned-and-forbidden` | An agent is assigned what a role forbids; the assignment wins. |
| info | `task-unverified` | Whether an agent can complete a task cannot be decided from the source. |
| warning | `grounding-missing` | `simulation.grounding` names a recording that is not among the recordings of the project. In the view and in `bca view`. |
| info | `grounding-differs` | A process test and the recording it stands on do not go through the same objects. In the view and in `bca view`. |

`--fail-on` (or `simulation.failOn`) sets the severity that fails the run.

## In CI, in VS Code, in German, for agents

- **CI and Git hooks:** `simulate` is a task of `bca run`, next to `check`.
  It fails the run like `bca simulate` does and writes the report to
  `simulation.outputDir`. See [Automation](./automation-and-ci.md).

  ```json
  { "automation": { "triggers": { "ci": { "tasks": ["check", "simulate"], "sync": "verify" } } } }
  ```

- **VS Code and the exported view:** with process tests in the project, the
  BC Atlas view has the lenses **Processes**, **People**, and
  **Requirements**, and a story per process: its tests in order, step by
  step, on the objects each touches. Whoever is blocked is red, and the
  finding on them says which permission is missing.
- **German:** `--language de` writes the report and the steps in German.
- **AI agents:** `bc_atlas_simulation_define` changes the company and runs
  it (see [Define the simulation](#define-the-simulation)); the MCP tool
  `bc_atlas_simulate` returns the report. An agent
  that sets up permission sets asks it which permission is missing, adds the
  line, and asks again; `agent` and `task` return the details of one agent or
  one process test. See [Agent integration](./agent-integration.md).
