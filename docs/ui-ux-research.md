# UI/UX research and implementation record

Reviewed on 2026-08-11. This record connects external evidence to concrete
interface decisions. It is intentionally narrower than the model and production
evidence in `research-foundations.md` and `production-readiness.md`.

## Product context

The frontend is an analyst workspace for monitoring traffic, triaging alerts,
inspecting model evidence, operating durable ingestion, reviewing model health,
and exercising the detector. It is not a decorative executive dashboard.
Decisions therefore optimize for fast recognition, explicit system state,
reversible actions, and honest evidence labels.

## Evidence translated into design rules

| Evidence | Design rule | Current implementation |
|---|---|---|
| WCAG 2.2 adds minimum target-size and visible-focus criteria. | Keep primary controls at least 24×24 CSS pixels, use 40–44px targets for repeated operational controls, retain a persistent keyboard focus indicator, and never require dragging. | Navigation, filters, dialog controls, alert actions, replay controls, and mobile actions meet the larger local target; all interactive paths remain keyboard operable. |
| WAI-ARIA Authoring Practices treats roles as behavioral contracts. | Prefer native buttons, inputs, tables, fieldsets, and dialogs; implement focus containment and restoration when a modal is necessary. | Alert rows contain real inspection buttons, the drawer and sign-in dialog contain focus, tabs implement keyboard behavior, and processing-path selection uses native radio inputs. |
| SOC alert-fatigue research consistently frames volume without prioritization or context as an analyst burden. | Put unresolved critical work and freshness first; keep severity, route, model score, explanation provenance, and disposition together; do not use color as the only signal. | The overview foregrounds open critical alerts, alert tables retain severity text/icons, and alert details colocate route, score, model versions, SHAP evidence, and analyst disposition. |
| Human-AI teaming research warns that model assistance must preserve analyst judgment and evidence inspection. | Describe scores according to their calibration status, distinguish attribution from causality, and keep analyst disposition explicit rather than automatically resolving alerts. | Score labels say probability or model score, explanations state that SHAP is not causal proof, and authenticated analysts choose alert status. |
| Recognition-over-recall and visibility-of-status heuristics reduce memory burden. | Name actions by operator intent and expose queue, retry, replay, stream, and freshness state directly. | The Observation Lab now offers “Analyze now,” “Queue reliably,” and “Replay as live traffic,” with consequences and limits visible before submission; ingestion operations expose state transitions and delivery timing. |
| Cyber-situational-awareness reviews find that no single visualization answers all stakeholder questions. | Pair compact charts with exact tables or lists, provide scope labels, and make visualization selection lead to the underlying records. | Timeline buckets open filtered alerts, model matrices have exact accessible tables, topology links back to alerts, and chart scope is stated in panel copy. |

## Dependency decision

No package was added in this iteration. The existing stack already covers the
required jobs: ECharts for statistical charts, Cytoscape with fCoSE for network
topology, Lucide for consistent icons, and Playwright plus Axe for browser and
accessibility checks. Native HTML is a better fit for the new processing-path
selector than a form or component dependency because it preserves semantics,
keyboard behavior, and bundle size.

## Alert-triage iteration

The second interface pass focuses on the highest-frequency decision loop rather
than adding another visualization. NIST's human-centered cybersecurity work
frames efficiency in terms of the time and cognitive resources people need to
complete security work. SOC research similarly shows that explanation alone is
not enough: analysts benefit when the relevant context is prioritized, while
newer controlled studies caution that XAI can increase reliance without
necessarily improving collaborative performance.

That evidence led to four changes:

- the alert queue now has a visible title, result scope, newest-first ordering,
  and intent-named quick views before the detailed filters;
- every filter has a persistent label instead of depending on placeholder or
  option text;
- human disposition and optional investigation notes appear immediately after
  the detection summary, before deep model evidence; and
- the backend's disposition history is rendered as a chronological evidence
  trail, and a newly saved decision appears without closing the alert; and
- raw flow features remain available as exact evidence but are collapsed by
  default so 83 values do not dominate every investigation.

This is progressive disclosure, not evidence removal. Route context, reasons,
SHAP stages, exact signed impacts, model versions, scores, and raw features all
remain in the same alert dialog. No dependency was added: native navigation,
labels, textarea, and disclosure elements provide the required semantics and
keyboard behavior.

## Backend capability boundary

The analyst-facing frontend exposes immediate single/batch prediction, durable
HTTP ingestion, dataset replay, custom-observation replay, replay controls,
alerts and explanations, analyst feedback, dashboard summaries, model
descriptors/evaluations/health, ingestion jobs, outbox evidence, redrive, auth,
health, and live events. `/ingestion/offline-pcap/events` remains intentionally
server-owned: the backend documents it as the local offline-PCAP command's
channel, so presenting it as a browser upload would create a false capability.
`/metrics`, `/livez`, and `/readyz` remain machine-facing operational endpoints;
their relevant health evidence is summarized in the human interface.

## Network-topology iteration

The topology pass follows research that treats cyber situational awareness as
more than perception of a dense visual map. The systematic review of 54 CSA
visualization studies found that most tools stop at low-level threat perception
and that relatively little evidence supports higher-level comprehension or
decision making. Research co-designed with blind and low-vision readers also
identifies structure, navigation, and semantic description as separate needs;
a single image description or a long flat sequence is not equivalent to
interactive exploration.

Implementation consequences:

- the canvas remains an overview, while a tabbed endpoint/route inventory is
  the authoritative keyboard and screen-reader exploration surface;
- the workspace now provides a textual high-level observation, visible scope
  metrics, explicit map legend, selectable relationship details, and truthful
  links back to the alert queue;
- the selected detail is pinned above the scrollable inventory so choosing a
  relationship does not send its result off-screen;
- on narrow screens the structured explorer precedes the dense visual map,
  keeping investigation and alert navigation ahead of optional spatial context;
- open high/critical relationships are prioritized before low-risk volume; and
- resolved severity is now modeled separately from unresolved severity. A
  resolved critical alert can no longer incorrectly label a currently low-risk
  route as open critical risk.

No dependency was added. Cytoscape and fCoSE remain appropriate for the visual
network layout, while the existing shared tab component and native HTML provide
the non-visual structure and keyboard interaction.

## Model-operations iteration

The previous model page placed runtime monitoring before a long, visually
continuous body of offline test evidence. That made three different claims look
equivalent: which version is serving, whether observed traffic has shifted, and
how candidates performed under an offline protocol. NIST's AI RMF separates
governance, measurement, and management activities and emphasizes documented
monitoring after deployment. Model Cards likewise call for evaluation results
to be accompanied by intended context, procedures, limitations, and
disaggregated evidence instead of presenting a headline score alone.

Implementation consequences:

- the model workspace now opens with the runtime serving bundle and production
  health, while offline evaluation has a separate, explicit workspace view;
- the detector and family-classifier roles show runtime-reported version,
  activation state, and whether their scores are calibrated probabilities;
- the offline champion remains labelled as test evidence and cannot be mistaken
  for the currently deployed runtime descriptor;
- health state, reason, cohort/window, observation count, and trend remain
  visible, while exact aggregate, feature, category, and history tables use
  named native disclosures; and
- evaluation data is fetched only after the user opens the offline view,
  avoiding an unnecessary request during operational monitoring.

No runtime dependency was added for this redesign. Shared tabs and native
`details`/`summary` elements supply the required keyboard and disclosure
semantics.

## Storybook documentation baseline

Storybook was added only after checking its current package metadata. Version
10.5.7's official React/Vite adapter supports React 19, Vite 6, and the
project's TypeScript version. The catalogue documents every currently exported
operator-facing React surface: shared headings, severity labels, keyboard tabs,
error containment, all chart families, alert queue and drawer, replay and
ingestion states, overview, topology, model analysis and health, and observation
testing. Its 80 stories cover meaningful ready, loading, empty, unavailable,
partial, active, and failed states. Stories live next to their components and
use Component Story Format, following Storybook's recommended structure.

The official Docs and Accessibility addons are the only addons included. The
project-wide accessibility setting treats automated violations as errors, while
the catalogue explicitly notes that keyboard, screen-reader, zoom, and human
testing remain necessary. Future redesign iterations must add or update stories
alongside their implementation so Storybook grows into the complete living UI
inventory rather than a disconnected showcase.

## Ingestion-operations completeness iteration

A route-to-affordance audit found that job creation ranges and outbox event
types existed in the backend but were absent from the operator workspace. The
SOAR user study reports that security investigations depend on querying and
correlating diverse evidence and that reducing context switching can improve
efficiency. W3C form guidance additionally requires visible labels and any
format instructions users need; placeholders alone are not sufficient.

Implementation consequences:

- job evidence now supports the complete state, error-code, source, created
  after, and created before backend filter contract;
- outbox evidence now supports both publication state and event type;
- filter edits are drafts until an explicit Apply action, preventing a server
  request for every keystroke and keeping cursor pagination tied to a stable
  query;
- the applied scope remains visible beneath the controls, while Clear filters
  resets both the draft and server query;
- local-time instructions accompany native date/time controls, inverted ranges
  are rejected before any request, and all controls retain visible labels; and
- dataset replay now exposes the backend-supported row offset, making bounded
  later-window replays reproducible without inventing another scenario.

No dependency was added. Native forms, fieldsets, labels, date/time and numeric
inputs provide the required interaction and accessibility semantics. The full
route mapping and explicit machine/server ownership boundaries are maintained
in `docs/backend-ui-capability-matrix.md`.

## Overview readiness iteration

The overview previously placed the complete `/health` component inventory in a
long side-column fact list. Healthy and failed components had equal visual
weight, important readiness evidence appeared late on the page, and fixture
alert counts were incorrectly described as persisted database evidence.

Cyber-situational-awareness research distinguishes perceiving state from
understanding what it means for action. NIST's human-centered cybersecurity
program similarly emphasizes helping people make informed decisions, while
USWDS summary guidance recommends selecting, splitting, and sequencing only the
few critical facts readers should not miss before dense detail.

Implementation consequences:

- system readiness now follows the alert-posture summary near the top of the
  overview instead of appearing after secondary protocol composition;
- the default panel states the operational assessment, prioritizes degraded or
  blocked component reasons, and shows only API, stream, model-bundle, and
  replay-dataset state;
- instance, schema, model versions, calibration, checksum, fallback, live-event
  time, and every backend component reason remain available in one named native
  disclosure with an exact table;
- fixture mode explicitly says that no connected health request was made; and
- metric and scope copy now distinguishes fixture, loaded-session, and
  persisted database evidence instead of calling all values persisted.

No dependency was added. The new `SystemHealthPanel` is a focused feature
component with ready, degraded, blocked, unavailable, and fixture Storybook
states.

## Observation-result review iteration

The Observation Lab previously collapsed up to 10,000 AI outcomes into one
nine-column table. That made discrepancies difficult to find, forced mobile
users through a wide horizontal grid, and mixed detector, classifier, score,
model, alert, and reference-label evidence at the same visual level. It also
compared `normal` directly with source labels such as `MQTT_Publish`, falsely
reporting canonical normal traffic as a mismatch.

Microsoft's empirically refined human-AI interaction guidelines recommend
making both system capability and likely error clear, showing information that
is relevant to the current task, and making explanations available after an
outcome. The NIST AI RMF Playbook likewise separates what happened, how an
output was produced, and what it means in context. W3C table guidance advises
keeping complex datasets simple or separating them into smaller topics while
preserving responsive access to every relationship.

Implementation consequences:

- the default result view states the comparison scope and separates detector
  discrepancies from attack-family discrepancies;
- summary counts and All, Needs review, and Attack verdict filters prioritize
  exception review without hiding the full result set;
- each paged observation is a responsive semantic record with verdict,
  reference, family, and alert outcome, while exact serving model and score
  evidence uses a native disclosure;
- score copy continues to distinguish calibrated probabilities from model
  scores and explicitly avoids presenting a controlled upload as a performance
  estimate;
- canonical RT-IoT2022 normal labels are mapped to the binary normal target
  before comparison; and
- empty, mixed prediction, durable-queue, and custom-replay outcomes are now
  independently documented in Storybook.

No dependency was added. The backend prediction response now has a shared
frontend type instead of crossing the API boundary as `unknown`.

## Model-health decision-support iteration

The model-health backend exposes cohort identity, fast and slow monitoring
windows, calibrated feature and output signals, unseen categories, input
quality, labelled outcomes, analyst review, and historical checks. The prior UI
showed the overall state and a generic chart but hid the alarm drivers in dense
disclosures. Storybook documented only the fixture boundary, so collecting,
healthy, warning, critical, blocked, loading, empty, and failed states could not
be reviewed independently.

NIST's AI RMF treats production monitoring as a continuous, contextual risk
activity and explicitly separates quantitative measurements from human and
domain-expert input. NIST's 2026 monitoring report also identifies reducing
human monitoring burden and combining automation with human validation as open
challenges. DriftVis research found that a single drift number cannot explain
why change occurred and recommends highlighting the distributions or features
that drive it. W3C guidance requires the exact tabular relationships behind a
visualization to remain programmatically available.

Implementation consequences:

- the API controller and pure `ModelHealthView` are separated, so every backend
  state can be represented without Storybook network calls;
- the default hierarchy now presents assessment, exact cohort/window scope,
  observations, feature alarms, output alarms, aggregate signal and threshold,
  labelled rows, and analyst-reviewed alerts before the trend;
- warning and critical states surface their strongest feature drivers, output
  alarms, and unseen categories instead of asking the operator to search six
  evidence tables;
- copy states that aggregate drift signals are not probabilities and that
  distribution change is not proof of accuracy loss;
- the trend has a visible and programmatic summary, and now plots each backend-
  reported threshold instead of the previous hard-coded `1.0` line; and
- exact cohort, reference, quality, output, performance, feature, unseen-value,
  and history tables remain keyboard-focusable native evidence regions.

No dependency was added. Model health now has nine dedicated Storybook states.

## Ingestion investigation and recovery iteration

The ingestion-operations screen previously treated durable jobs and outbox
records as two wide tables and described the entire surface as read-only even
though dead-letter detail contained an authenticated mutation. A backend/UI
contract audit also found that processing leases, model route, last-redrive
audit data, and most immutable-transition fields were discarded by frontend
types. Operators therefore could not see all of the evidence used to explain
or safely recover a failed job.

AWS transactional-outbox guidance warns that delivery can occur more than once
and recommends idempotent consumers; the interface must therefore show exact
publication attempts and retry/claim timing rather than imply simple exactly-
once delivery. AWS dead-letter guidance treats the queue as a diagnostic space
before redrive and recommends controlled recovery that does not overwhelm the
source. W3C table guidance requires native header/data relationships and says a
responsive presentation must preserve those relationships when the format
changes.

Implementation consequences:

- job and outbox results now begin with explicitly scoped current-page counts,
  while separately reporting the backend's total matching result count;
- each job shows state-specific queue timing, including processing lease expiry,
  retry availability, completion, or dead-letter hold state;
- outbox rows preserve publication attempts, active claim leases, scheduled
  retries, publication time, and last error so at-least-once delivery evidence
  is visible;
- selecting a job moves focus to an investigation placed before the queue, and
  closing it restores focus to the exact originating control;
- detail now exposes source, schema, extractor, model route, attempts,
  retryability, redrive count, and the last operator/time/reason recovery audit;
- immutable transitions now include occurrence and record time, reason code,
  worker/operator identity, retryability, and structured backend details;
- dead-letter recovery requires a meaningful audit reason, a read-only
  eligibility preview, and a second focused confirmation before execution; and
- semantic wide-screen tables have keyboard-focusable named scroll regions,
  while narrow/zoomed views use equivalent structured cards instead of forcing
  a nine-column viewport.

No dependency was added. The API controller remains responsible for fetching
and authentication; pure job, outbox, and investigation views provide nine
independent Storybook states without inventing connected evidence.

## Model-evaluation evidence iteration

The model workspace correctly separated serving state from offline evaluation
in its navigation, but fixture mode silently rebuilt an “evaluation” from
serving descriptors. That substituted runtime metadata for benchmark evidence.
The frontend adapter also discarded evaluation seeds, the structured split
definition, validation metrics, operational p95 latency and model size, while
coercing absent measurements to zero. These behaviors weakened the evidence
boundary the page claimed to enforce.

NIST AI RMF Measure guidance requires test sets, metrics, and evaluation tools
to be documented, measurements to be interpreted in deployment context, and
limitations on generalization to be explicit. Model Cards likewise recommend
reporting performance characteristics with their intended context and limits.
Scikit-learn's evaluation guidance distinguishes validation used during model
selection from a test set retained for final evaluation. W3C guidance calls for
textual context and semantic tables as alternatives to complex charts.

Implementation consequences:

- fixture mode now states that connected evaluation evidence is absent and
  never converts serving descriptors into benchmark candidates;
- the evaluation view begins with an explicit offline-only boundary and then
  identifies the selected artifact, split strategy, stratification, declared
  seeds, and calibration meaning before any headline score;
- structured split fields remain available in a native disclosure instead of
  being collapsed into an opaque JSON sentence;
- validation selection score and multi-seed aggregates are separated from
  held-out test macro F1, weighted F1, false-positive rate, and confusion data;
- exact candidate evidence adds backend p95 inference latency and preserves
  missing measurements as “not reported” instead of zero;
- the serving bundle now exposes schema identity and whether an artifact is
  registered without leaking its server filesystem path;
- seed aggregates use a semantic table rather than a grid of generic elements,
  and every chart retains a named, keyboard-focusable exact table; and
- pure `ModelEvaluationView` presentation supports detector, classifier,
  loading, empty, unavailable, and fixture-boundary Storybook states without
  network mocking.

No dependency was added. Model analysis now has nine dedicated Storybook states
and the complete catalogue contains 80 stories.

## Topology evidence iteration

The topology workspace already offered a useful force-directed map and a
structured endpoint/route list, but it represented every zero-result state as
“no matching routes.” It also omitted the most important provenance boundary:
the relationships are aggregated from the frontend's currently loaded alert
cache, not the complete persisted alert corpus. A refresh failure with cached
records was therefore indistinguishable from a healthy view, and a source
failure before any records loaded looked like genuine absence.

W3C guidance for complex images recommends a concise visual summary plus a
complete, structured description of the values and relationships represented.
Its keyboard guidance also separates focus from selection and requires every
interaction to remain operable without pointer input. The cyber situational
awareness visualization review already used in this project emphasizes that
visual encodings should support investigation and sensemaking rather than act
as decorative network diagrams.

Implementation consequences:

- an evidence-scope strip identifies connected cache data versus an
  illustrative fixture sample and directs operators to the paged alert queue
  for complete persisted search;
- loading, genuine empty, unavailable, refreshing, and cached-refresh-failure
  states are distinct, with recovery available wherever retry is meaningful;
- the visual map retains a concise accessible summary while the adjacent
  endpoint and directed-route explorer exposes the exact same relationships as
  native keyboard-operable buttons and definition lists;
- explorer ordering is stated explicitly: open severity, unresolved count,
  then alert volume, matching the aggregation contract;
- filter and selection reset actions are explicit and keyboard reachable, and
  selecting evidence remains an activation rather than silently following
  focus;
- identity classification validates IPv4 and IPv6 values before calling them
  network addresses; hostnames, port-only fallbacks, and missing identifiers
  remain clearly labelled as limited observations rather than confirmed
  devices; and
- mobile reading order places exact structured evidence before the canvas map,
  while preserving the same actions and details.

No dependency was added. Cytoscape and fCoSE remain appropriate for the visual
layout, while native HTML supplies the complete interaction and evidence
alternative. Topology now has eight dedicated Storybook states and the complete
catalogue contains 86 stories.

## Alert-investigation decision workspace iteration

The alert queue exposed the correct paged search contract, but its investigation
drawer mixed every task into one long document. The frontend adapter discarded
the alert's event identity and structured network provenance, the explanation
failure state had no recovery action, and the “Other features” waterfall value
was summed from the backend order rather than the absolute-impact order used by
the visible chart. Storybook documented only one read-only drawer without
on-demand model evidence.

The SOC user study of SHAP and LIME found that explanations can help analysts by
highlighting relevant alert information, but explanation utility depends on the
analyst task and context. NIST's human-centered cybersecurity program frames
security controls as systems that must account for human capabilities and
operational behavior. W3C's modal-dialog pattern requires contained focus,
Escape dismissal, an accessible name, and focus return; its complex-image
guidance requires the complete values and relationships behind a visualization
to remain available as structured content.

Implementation consequences:

- the queue and investigation drawer are separate React modules, and a pure
  investigation view makes backend states independently documentable without
  Storybook network requests;
- investigation is organized into Triage, Model evidence, and Record data tabs,
  while alert severity, current disposition, detector verdict, and score remain
  visible at the top of the default decision task;
- every backend disposition state is available through one labelled form;
  terminal decisions require meaningful reasoning and a review/confirmation
  step before the authenticated mutation is sent;
- immutable feedback history displays operator, time, state, and reasoning, and
  never asks the browser to supply the audit identity;
- event ID, binary detector verdict, attack class, ports, capture ID, interface,
  extractor fingerprint, exact model versions, and per-stage latency now cross
  the API boundary and appear in the appropriate evidence section;
- model scores are labelled as model outputs rather than probabilities because
  the alert response does not declare their calibration state;
- the SHAP view begins with a non-causal decision-support boundary, exposes the
  strongest positive and negative drivers and an additive reconstruction check,
  and retains every transformed/raw value and signed impact in a semantic table;
- the summarized waterfall and its “Other features” value now derive from the
  same absolute-impact ordering, with a direct regression test; and
- explanation loading, empty, historical-artifact failure, retry, complete
  evidence, limited route identity, provenance, existing history, and fixture
  boundaries are independently represented in Storybook.

No dependency was added. Native tabs, form controls, disclosures, tables, and
the existing focus-management approach cover the interaction contract. Alert
investigation has eight dedicated Storybook states and the complete catalogue
contains 93 stories.

## Observation Lab preflight iteration

The Observation Lab previously made a custom-styled drop target its only file
control, showed no row preview, and checked only the presence and order of CSV
headers. Blank categorical values and non-finite numeric values could therefore
reach an all-or-nothing backend request without identifying the row to correct.
The custom replay API accepted speeds above 0 through 100×, but the browser
silently submitted every uploaded replay at 1×. One global 10,000-row browser
limit also hid the distinct 1,000-row durable-ingestion and 100,000-row replay
contracts.

The U.S. Web Design System file-input guidance keeps a labelled native file
input as the accessible source of truth and treats drag-and-drop as progressive
enhancement; it also warns that combining “drag” and “choose” into one announced
action can confuse screen-reader users. WCAG 2.2 Input Assistance and Error
Suggestion require errors to be identified in text and, when known, provide
correction guidance. Its error-prevention guidance supports a review step before
a persistent or consequential submission.

Implementation consequences:

- a real labelled CSV input is now the primary control, with file type, count,
  and 10 MB limits stated before selection; the adjacent drop target is an
  optional visual enhancement rather than a second ambiguous accessible action;
- source provenance includes the exact RT-IoT2022 extract checksum and source
  lines for the two verified examples;
- local preflight checks the canonical 83-feature order, non-blank categorical
  values, and finite numeric values across every row, then reports the exact row
  and feature with a correction while retaining a focused five-row preview;
- immediate prediction, durable ingestion, and custom replay are presented as
  explicit radio choices with their persistence, recovery, timing, follow-up,
  and distinct backend row limits visible before submission;
- custom replay now exposes the backend's 0.01–100× speed range and translates
  the selection into an approximate event cadence;
- selection, validation, and review remain local until the authenticated action,
  while fixture mode permanently states that no mutation can occur;
- submission failures preserve the validated file and provide retry guidance;
  completed prediction, queue, and replay responses retain their exact evidence;
  and
- presentation is separated from network orchestration so awaiting, valid,
  invalid-header, invalid-value, configured, submitting, failed, completed, and
  fixture states can be reviewed independently in Storybook.

No dependency was added. Native file, radio, number, table, disclosure, and
status semantics cover the workflow. Observation Lab now has fourteen dedicated
Storybook states and the complete catalogue contains 106 stories.

## Dataset-replay control iteration

The overview replay control previously combined configuration and active-run
state in one compact row. It exposed only four speeds even though the backend
accepts values above 0 through 100×, capped dataset runs at 1,000 observations
despite the backend's 1,000,000 limit, described the source offset ambiguously,
and disabled the whole control with only a generic connection message. An
active run showed one progress sentence but did not distinguish the server's
accepted scenario, speed, offset, and limit from the browser's next-run values.
Stopping immediately abandoned the remainder without a consequence review.

The validated Microsoft Research human-AI interaction guidelines recommend
making capabilities clear, showing contextually relevant information,
supporting efficient correction, conveying the consequences of actions, and
providing global controls. NIST Human-Centered Cybersecurity frames operators as
active, informed security partners rather than passive recipients. WCAG 2.2
requires descriptive textual input errors and programmatically determinable
status/progress messages, while warning against overly chatty live regions. Its
error-prevention guidance recommends reversible, checked, or confirmed actions.

Implementation consequences:

- the console now separates local run configuration from a server-owned
  lifecycle snapshot, so planned values cannot be mistaken for accepted state;
- the scenario selector states that exact families use exact dataset labels,
  the offset is identified as a zero-based source row applied before scenario
  filtering, and the server may match fewer rows than the requested bound;
- numeric inputs expose the full 0.01–100× speed and 1–1,000,000 observation
  contracts without silently clamping mistakes; invalid fields retain their
  values, identify themselves with `aria-invalid`, give textual correction, and
  block only the affected Start or Resume action;
- the 250 ms base cadence, approximate selected cadence, upper duration bound,
  persistence effect, alert effect, and live-publication effect are visible
  before a run starts;
- running, paused, completed, stopped, failed, unavailable, and stale-snapshot
  states have distinct text and styling, while the native progress element
  exposes exact processed, remaining, total, and percentage evidence without an
  announcement for every polling tick;
- paused runs allow a valid speed change before Resume, while source selection,
  offset, and limit stay locked to the accepted run;
- stopping opens an inline, focus-managed review stating that processed records
  remain persisted, how many observations will not be emitted, and that the run
  cannot resume; cancellation returns focus to the invoking control;
- readiness failures name the API, dataset, database, or model-bundle reason,
  and a failed status refresh keeps the last successful server snapshot visible
  with an explicit retry; and
- pending mutations prevent duplicate commands and label the exact operation in
  progress.

No dependency was added. Native fieldsets, labels, inputs, select, progress,
status, and focused confirmation controls cover the interaction contract.
Dataset replay now has seventeen dedicated Storybook states and the complete
catalogue contains 117 stories.

## Monitoring situation-briefing iteration

The monitoring overview mixed three evidence scopes inside the same metric row:
persisted database-window totals, the browser's loaded alert cache, and live
events received only during the current session. It discarded the dashboard
API's complete severity and disposition distributions, while fixture-only
ECharts visualizations had no visible exact-value alternative. Runtime health,
ingestion, and the full operations ledger appeared before the alert workload.
Changing the summary range also reloaded unrelated health, model, and alert
requests; the selector could show the newly requested range while the old
summary remained on screen without being labelled stale.

The systematic review of cyber situational-awareness visualization research
emphasizes that heterogeneous, multidimensional security evidence must support
analyst sensemaking rather than become an ornamental dashboard. NIST
Human-Centered Cybersecurity treats practitioners as active, informed partners.
W3C complex-image guidance requires a concise description of a chart's main
relationship plus a structured long description containing exact values, and
its table guidance recommends semantic row/column headers and captions that
identify purpose and aid navigation.

Implementation consequences:

- the page begins with a situation briefing and explicit persisted/fixture
  boundary, followed by workload, chronology, queue handoff, composition, and
  only then serving/delivery operations;
- persisted-window prediction, alert, unresolved, critical-open, and median
  model-output metrics are separate from a labelled browser-session/cache strip
  containing live-session predictions, loaded alerts, route labels, stream
  state, and last event time;
- the summary exposes source, included record types, aggregation strategy,
  time field, selected range, exact window boundaries, bucket resolution,
  checked/generated times, and the backend's persisted-total reconciliation;
- summary loading, empty, unavailable, stale, and requested-range-transition
  states remain distinct; a stale snapshot retains its actual backend range and
  generation evidence while the requested range loads or fails;
- summary retrieval is now independent of health, model, and alert-cache
  hydration, and successful status refreshes clear prior errors;
- timeline bars summarize severity composition visually without making narrow
  data marks into pointer-only controls; a labelled, keyboard-scrollable table
  provides every interval and a native button for opening each non-empty bucket;
- peak activity and critical volume form the chart's short description, while
  the exact table caption and row/column headers form its structured long
  description;
- all backend `severity_counts`, `status_counts`, `family_counts`, and
  `protocol_counts` are visible as exact semantic lists, including empty states;
- recent alerts permanently identify their loaded-cache scope and hand off to
  the complete persisted queue, while cache-refresh failure does not invalidate
  the independent persisted summary;
- fixture records never receive a fabricated database timeline or persisted
  totals; and
- `IngestionStatusPanel`, `OverviewOperations`, and the situation-focused
  `Overview` now have separate modules and Storybook documentation instead of a
  network-coupled overview monolith.

No dependency was added. Native sections, definition lists, lists, figure/
figcaption, details, progress-free CSS bars, and semantic tables cover the
evidence contract. Monitoring overview has eleven dedicated states, ingestion
status has nine, and the operations composition has one; the complete Storybook
catalogue contains 133 stories.

## Sources

- [Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/)
- [WAI-ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)
- [Combating Alert Fatigue in the Security Operations Centre](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4633965)
- [Towards Human-AI Teaming to Mitigate Alert Fatigue in Security Operations Centres](https://doi.org/10.1145/3670009)
- [Systematic Literature Review on Cyber Situational Awareness Visualizations](https://arxiv.org/abs/2112.10354)
- [Nielsen Norman Group heuristic summary](https://media.nngroup.com/media/articles/attachments/Heuristic_Summary1_A4_compressed.pdf)
- [NIST Human-Centered Cybersecurity](https://www.nist.gov/itl/tted/human-centered-technologies)
- [Towards XAI in the SOC — a user-centric study of explainable alerts](https://doi.org/10.1109/BigData55660.2022.10020248)
- [You Know Why, but Still Rely — XAI, trust, task load, and cybersecurity decisions](https://www.usenix.org/conference/usenixsecurity26/presentation/roch)
- [Systematic Literature Review on Cyber Situational Awareness Visualizations](https://doi.org/10.1109/ACCESS.2022.3178195)
- [Rich Screen Reader Experiences for Accessible Data Visualization](https://vis.csail.mit.edu/pubs/rich-screen-reader-vis-experiences/)
- [W3C guidance on equivalent alternatives for complex visual content](https://www.w3.org/WAI/wcag-curric/gid2-0.htm)
- [NIST AI Risk Management Framework Playbook](https://www.nist.gov/itl/ai-risk-management-framework/nist-ai-rmf-playbook)
- [Model Cards for Model Reporting](https://research.google/pubs/model-cards-for-model-reporting/)
- [Storybook: How to write stories](https://storybook.js.org/docs/writing-stories)
- [Storybook: Accessibility testing](https://storybook.js.org/docs/writing-tests/accessibility-testing)
- [Testing SOAR Tools in Use](https://arxiv.org/abs/2208.06075)
- [W3C: Understanding Labels or Instructions](https://www.w3.org/WAI/WCAG21/Understanding/labels-or-instructions.html)
- [U.S. Web Design System date-range accessibility tests](https://designsystem.digital.gov/components/date-range-picker/accessibility-tests/)
- [NIST Human-Centered Cybersecurity](https://csrc.nist.gov/Projects/human-centered-cybersecurity/about)
- [Systematic Literature Review on Cyber Situational Awareness Visualizations](https://arxiv.org/abs/2112.10354)
- [U.S. Web Design System summary-box guidance](https://designsystem.digital.gov/components/summary-box/)
- [Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf)
- [NIST AI Risk Management Framework Playbook](https://airc.nist.gov/docs/AI_RMF_Playbook.pdf)
- [W3C data-table tips and responsive guidance](https://www.w3.org/WAI/tutorials/tables/tips/)
- [W3C table captions and summaries](https://www.w3.org/WAI/tutorials/tables/caption-summary/)
- [NIST AI Risk Management Framework Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)
- [NIST: Challenges to the Monitoring of Deployed AI Systems](https://www.nist.gov/news-events/news/2026/03/new-report-challenges-monitoring-deployed-ai-systems)
- [Diagnosing Concept Drift with Visual Analytics](https://arxiv.org/abs/2007.14372)
- [W3C accessible data-table guidance](https://www.w3.org/WAI/tutorials/tables/)
- [AWS Prescriptive Guidance: transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)
- [AWS: using dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)
- [AWS: configuring dead-letter queue redrive](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html)
- [W3C responsive data-table tips](https://www.w3.org/WAI/tutorials/tables/tips/)
- [NIST AI RMF Core: Measure](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)
- [Model Cards for Model Reporting](https://research.google/pubs/model-cards-for-model-reporting/)
- [Scikit-learn: cross-validation and held-out evaluation](https://scikit-learn.org/stable/modules/cross_validation.html)
- [W3C accessibility principles for complex visual content](https://www.w3.org/WAI/fundamentals/accessibility-principles/)
- [W3C: Complex images](https://www.w3.org/WAI/tutorials/images/complex/)
- [WAI-ARIA APG: Developing a keyboard interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [WAI-ARIA APG: Modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [NIST Human-Centered Cybersecurity](https://csrc.nist.gov/Projects/human-centered-cybersecurity/about)
- [Towards XAI in the SOC — user study of explainable alerts](https://www.ffi.no/en/publications-archive/towards-xai-in-the-soc-a-user-centric-study-of-explainable-alerts-with-shap-and-lime)
- [U.S. Web Design System file input](https://designsystem.digital.gov/components/file-input/)
- [W3C: Understanding Input Assistance](https://www.w3.org/WAI/WCAG22/Understanding/input-assistance.html)
- [W3C: Understanding Error Suggestion](https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html)
- [W3C: Understanding Error Prevention](https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html)
- [Microsoft Research: Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/research/project/guidelines-for-human-ai-interaction/)
- [NIST Human-Centered Cybersecurity](https://csrc.nist.gov/Projects/human-centered-cybersecurity/about)
- [W3C: Understanding Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages)
- [W3C: Understanding Error Identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification)
- [W3C: Understanding Error Prevention (All)](https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-all)
- [Systematic Literature Review on Cyber Situational Awareness Visualizations](https://doi.org/10.1109/ACCESS.2022.3178195)
- [W3C: Complex images](https://www.w3.org/WAI/tutorials/images/complex/)
- [W3C: Accessible tables](https://www.w3.org/WAI/tutorials/tables/)
- [W3C: Table captions and summaries](https://www.w3.org/WAI/tutorials/tables/caption-summary/)
