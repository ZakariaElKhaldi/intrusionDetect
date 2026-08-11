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
project's TypeScript version. The initial catalogue documents shared headings,
severity labels, keyboard tabs, the serving bundle, and the complete model
workspace in multiple meaningful states. Stories live next to their components
and use Component Story Format, following Storybook's recommended structure.

The official Docs and Accessibility addons are the only addons included. The
project-wide accessibility setting treats automated violations as errors, while
the catalogue explicitly notes that keyboard, screen-reader, zoom, and human
testing remain necessary. Future redesign iterations must add or update stories
alongside their implementation so Storybook grows into the complete living UI
inventory rather than a disconnected showcase.

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
