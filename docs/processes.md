# Processes: how the company works with the app

A **process** is a model of how the company works with the app: steps in
lanes, as in BPMN. Every step is in the lane of the role that does it, names
what shows that it works, and comes after other steps. You draw it, BC Atlas
finds it in the process tests and recordings (process mining), runs it with
the people of the [simulation](./battle-test.md), and says what to improve.

```json
{
  "processes": [
    {
      "id": "purchase-requests",
      "title": "Purchase requests",
      "steps": [
        { "id": "create", "title": "Create a request", "lane": "Employee", "test": "purchase-request-create" },
        { "id": "approve", "title": "Approve it", "lane": "Team lead", "test": "purchase-request-approve", "after": ["create"] },
        { "id": "order", "title": "Order", "lane": "Purchaser", "test": "purchase-request-order", "after": [{ "step": "approve", "when": "approved" }] },
        { "id": "change", "title": "Change the request", "lane": "Employee", "after": [{ "step": "approve", "when": "rejected" }] }
      ]
    }
  ]
}
```

| Part of a step | Meaning |
| --- | --- |
| `id`, `title` | Its name for the wires, and what people call it. |
| `lane` | Who does it: a role of the company (`simulation.roles`). |
| `test` | What shows that it works: a process test (an AL UI test with `[SCENARIO]`, by its document ID) or a recording of Business Central. Without one the step is **unproven**. |
| `after` | The steps it comes after. A wire with a `when` is one way of several (an exclusive gateway in BPMN); without one, the steps simply follow. A wire may lead back to an earlier step: a **loop**, as when a request that was rejected is changed and released again. |

BC Atlas reads the source and the recordings. It runs neither the app nor the
tests: what a step needs comes from what its test does in the code, and who
can do it from the permission sets of the roles.

## Start from what is there: process mining

```sh
bca process --mine                               # the processes as the tests and recordings have them
bca process --mine --recordings recordings       # with recordings of Business Central
bca process define --adopt purchase-requests     # take one as a model to change
```

Mining discovers one process per use case from the process tests and the
recordings (fact snapshots, as the [sync plugin](../plugins/sync/README.md)
reads them, or `simulation.recordings`):

- **the order**: what a test requires comes before it, else the tests follow
  each other; an alternative is another way from the same step;
- **the lane** of each step: the role of the person who gets through it in the
  simulation;
- **the events** of each step, from what it does in the app: clicks, pages
  opened, code run, reads, and writes, and the objects it touches;
- **the handovers**: where the work changes from one role to another.

A mined process is what the app does today. Take it as a model and change it
into what the company should do: that difference is what the run reports.

## Its time: telemetry

The source and a recording have no time. Business Central has: it sends
telemetry to Azure Application Insights (page views, and traces of what ran,
with the AL object and how long it took). BC Atlas reads that as an event log
and lays it over the processes.

```json
{
  "processTelemetry": {
    "path": "telemetry",
    "case": "requestNo"
  }
}
```

```sh
bca process --mine                         # with processTelemetry.path in .bca.json
bca process --mine --telemetry telemetry   # or a file or folder named here
bca process run --telemetry telemetry
```

```text
Telemetry: 12 case(s), 93 event(s), 2026-10-05 to 2026-10-11. A case takes 2.5 d on average, 3.8 d for the slowest.
The ways really taken:
     9 case(s)  create > release > approve > order
     3 case(s)  create > release > approve > create > release > approve > order
Between the steps:
  release > approve: 15 time(s), in 100% of the cases, waiting 1.4 d on average (2.5 d for the slowest)
  approve > create: 3 time(s), in 25% of the cases, waiting 20 h on average
```

| It gives | Meaning |
| --- | --- |
| cases, and how long a case takes | from the first event of a case to its last: average, median, and the slowest (95%) |
| the ways really taken | every order of steps the cases went through, with how many went it (the variants) |
| per step | how often it is done, in how many cases, how long it takes, and in how many cases it is done again |
| per way between two steps | how often it is gone, in what share of the cases, and how long the work waits on it |

**Where the telemetry comes from.** `processTelemetry.path` (or `--telemetry`) is a
file or a folder of exports: the result of a query as JSON, a list of rows,
JSON lines, or CSV. In Application Insights, run this in **Logs** and export
the result:

```kusto
union pageViews, traces
| where timestamp > ago(30d)
| where isnotempty(customDimensions.alObjectId) or isnotempty(customDimensions.eventId)
| project timestamp, itemType, name, message, duration, session_Id, user_Id, customDimensions
```

Or let BC Atlas ask: with `"appId"` (the application ID of the resource) and,
optionally, `"days"` in `processTelemetry`, and an API key with the right to read
telemetry in the environment variable `BCA_TELEMETRY_API_KEY`, `bca process`
and the MCP tool ask Application Insights themselves. The key is never read
from `.bca.json`. The view and everything that is generated from the source
read telemetry from a file only, so they stay the same for the same files.

**Which event belongs to which step.** An event names an AL object. It belongs
to the step whose test touches that object. Where several steps touch it (the
same page for creating and approving):

1. an event named in `processTelemetry.steps` marks its step for certain:
   `"steps": { "purchase-request-approve": "PR0003" }` (an event id, or a text
   of the message, as the app sends it with `Session.LogMessage`);
2. else the step this person is seen doing, from the events only one step can
   have: who approves is who runs what only the approval runs;
3. else the step the case is in, else the next one on the way.

**What a case is.** `processTelemetry.case` names the field that says which case an
event belongs to: a custom dimension with the document number. Without it a
case is a session, and since a handover is another person in another session,
the wait between two roles is not seen. Standard telemetry has no such field:
the app has to send one.

The example in `examples/purchasing-app/telemetry` is made up, in the shape
Application Insights answers with.

## Build it in lanes

In the view, **Flow → Open the process builder** opens the builder on
**Processes**: a board with one lane per role.

- **Take a mined process** as a model, or name a new one and **Create** it.
- **Drag a process test or a recording** from the left into a lane: it is a
  step there, shown to work by that test. **Empty step** is a step that has no
  test yet. A new step comes after the step that is selected.
- **Drag a role** onto the board, or name a lane at the bottom, for a new
  lane. Change the name at the head of a lane to rename it.
- **Drag a step** into another lane to say that another role does it.
- **Pull a wire** from the dot on the right of a step into the step that comes
  after it. A wire into a step the way already passed is a way back: a loop,
  drawn dashed above the steps.
- **Double-click a step** for its title, lane, test, and the names of the ways
  into it (`approved`, `rejected`).
- Select a step or a wire and **Remove** it (or press Delete). When a step
  goes, the way closes around it: what came after it comes after what it came
  after. That is the same rule as for [a step of a flow](./flows.md#removing-a-step).
- With telemetry, a step shows how often it is done and how long it takes,
  and a wire the share of the cases that go it and how long the work waits.

Every step shows how it ran: green when its lane gets through it, red where
the process stops, amber when another role does it, nobody is set to do it, or
nothing shows that it works. **What to improve** below the lanes lists the
findings; a click goes to the step.

**▶ Play** walks the process on the graph, step by step: who performs the
step, what it does in the app, where the work changes hands, and where it
stops. **BPMN** saves the process as BPMN 2.0. The lens **Process models**
shows every process with its lanes and the tests behind its steps.

In VS Code a change is written to `.bca.json`. An exported view keeps the
changes and saves them as `process-changes.json` for
`bca process define --from process-changes.json`.

## Test and demonstrate it: the run

```sh
bca process run                               # every process, step by step
bca process run --process purchase-requests   # one
bca process run -o docs/processes.md          # as a page
bca process run --format json                 # for a pipeline or an agent
```

```text
Purchase requests
Stops: 5 step(s) in 4 lane(s), 3 handover(s).

1. [ok] Employee: Create a new Purchase Request
     starts the process
     performed by Anna (purchase-request-create)
     5 click(s): opens 1, runs 0, reads 1, writes 4
3. [STOPPED] Team lead: Approve a released purchase request
     after release: the work changes hands
     tried by Ben (purchase-request-approve)
     missing: codeunit "Request Notifications" = X
```

| A step | Means |
| --- | --- |
| runs | someone in its lane gets through its test |
| stopped | the lane is tried and cannot: the run names the missing permissions |
| other lane | another role performs it, not the lane it is drawn in |
| nobody | no role has its test among its tasks |
| unproven | it has no test and no recording |
| no test | it names a test that is not there |

`bca process run` exits with `1` when a process stops, so a pipeline can gate
on it. To run a step on what really happened, set a recording as its test, or
ground its process test on one (`simulation.grounding`, see
[Battle test](./battle-test.md)).

## What to improve

The run compares the model with the simulation and with the mined process:

| Finding | Says | To do |
| --- | --- | --- |
| `process-step-blocked` | the lane cannot perform the step | give the role what is missing |
| `process-step-other-lane` | another role does it | move the step, or give the lane the task |
| `process-step-unstaffed` | no role has the test among its tasks | add it to the tasks of the role |
| `process-step-unproven` | nothing shows that it works | write a process test or record it |
| `process-step-unknown-test` | its test is not there | set one that is |
| `process-lane-unknown`, `process-step-no-lane` | the lane is no role, or there is none | define the role, or name the lane after one |
| `process-back-and-forth` | the work goes from one lane to another and back | let one lane finish first |
| `process-step-not-in-model` | the tests have a step the model has not | add it, or decide it is not part |
| `process-order-differs` | the model has an order the app does not allow | wire the steps as the tests require |
| `process-loop` | the way leads back to an earlier step | see what makes the rework necessary |

With [telemetry](#its-time-telemetry), also:

| Finding | Says | To do |
| --- | --- | --- |
| `process-wait` | where the work waits longest, and between which roles | see how the next role learns that there is work |
| `process-rework` | a step is done more than once in a fifth of the cases or more | see which earlier step lets through what has to be done again |
| `process-step-slow` | a step takes more than twice as long as any other | see what it does in the app |
| `process-way-not-in-model` | the work really goes a way the model has not | wire it, with its name, or see why it is gone |
| `process-step-not-seen` | a step is in no case of the telemetry | nobody does it, or it cannot be told apart: name an event that marks it |

The findings are on the steps in the view (**Check**), in the story of the
process, and in `bca process run`.

## BPMN in and out

```sh
bca process export --process purchase-requests -o docs/purchase-requests.bpmn
bca process define --process returns --import returns.bpmn
```

The export is BPMN 2.0 with its diagram: a pool with a lane per role, a user
task per step, an exclusive gateway where named ways part. It opens in Camunda
Modeler, bpmn.io, and other tools.

The import reads a process another tool wrote: its lanes, its tasks (also
service tasks, sub-processes, and call activities), and the ways between them.
Events and gateways are not steps: a way through them is one way, named after
the sequence flow that leaves the gateway. A way back is a loop of the
process. An imported step has no test until you set one.

## From the terminal and for agents

```sh
bca process                                    # the processes and how each runs
bca process define --process orders --title "Sales orders"
bca process define --process orders --step "Take the order" --lane "Order processor" --test sales-order-create
bca process define --process orders --step "Post the order" --lane Accountant --after take-the-order:released
bca process define --process orders --at post-the-order --test sales-order-post
bca process define --process orders --rename-lane "Accountant=Finance"
bca process define --process orders --unstep post-the-order
```

AI agents use the MCP tools `bc_atlas_process` (the models, their runs, the
findings, and the mined processes) and `bc_atlas_process_define` (operations
on the models); see [Agent integration](./agent-integration.md). An agent that
improves a process reads the findings of a run, changes the model or the
roles, and reads the run again.

## What it does not do

- **The name of a way is a name, not a condition that is evaluated.** BC Atlas
  does not run the app, so it has nothing to evaluate `amount > 1000` against.
  What it can say is what really happened: with telemetry, the share of the
  cases that went each way.
- **A loop is walked once.** The run goes from the starts to the ends and
  names a way back; how often it is really gone around is in the telemetry.
- **It does not run the app.** A step that runs here is one whose test the
  role has every permission for; whether the test itself passes in Business
  Central is for the test run.
- **Telemetry is only as good as what tells the steps apart.** Two steps that
  use the same objects and are done by the same person cannot be told apart
  without an event that marks one of them, and without a case field the wait
  between two people is not seen.
