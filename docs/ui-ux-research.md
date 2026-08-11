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
testing. Its 57 stories cover meaningful ready, loading, empty, unavailable,
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
