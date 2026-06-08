---
title: Anomaly detection
description: Surfaces numeric metrics that drift outside their expected range based on recent history, as a separate signal from a system's health state.
---

Anomaly detection watches the numeric metrics inside a [health check](/checkstack/user-guide/concepts/health-checks/) result (latency, error rate, queue depth, and so on) and flags readings that drift outside their expected range based on recent history. It catches "this is weird, look at it" before a metric crosses a hard failure threshold. Anomalies are a separate signal from health state: a system can be perfectly healthy and still have an active anomaly.

## What counts as an anomaly

Checkstack learns a baseline for each monitored metric from its recent history (a rolling mean and spread) and looks for two kinds of deviation:

- **Spikes** are sudden jumps or drops, checked on every run. A reading far outside the normal band (a few standard deviations, tuned by sensitivity) is flagged.
- **Drift** is a slow trend that a single reading would not reveal, such as a memory leak or gradually rising latency. It is checked periodically by looking at the slope of recent samples.

> [!NOTE]
> Anomaly detection only runs on metrics a strategy has marked as eligible. You will see an Anomaly Detection card on a health check's configuration page when its result exposes metrics that support it.

## It does not change health state

An anomaly never flips a system to unhealthy. Health state and anomalies are deliberately independent signals:

- A **health check** answers "is this up or down?" using its state thresholds.
- An **anomaly** answers "is this metric behaving unusually?" against its own learned baseline.

Anomalies surface on the system detail page and feed the [dashboard](/checkstack/user-guide/concepts/catalog-and-dashboards/) signals and the assistant's "what is wrong?" view, but a system with an anomaly and all-passing checks still reads as healthy.

## How a reading becomes an alert

Detection is debounced so a single odd sample does not page anyone:

1. **Learning.** When a metric is new, Checkstack first collects enough samples to form a baseline. Until then the field shows as "Learning" and nothing fires.
2. **Suspicious.** A deviating reading is marked suspicious, not yet an anomaly.
3. **Confirmed.** Only after the deviation persists for a confirmation window (a few consecutive readings) does it become a confirmed anomaly and notify.
4. **Recovered.** When the metric returns to normal, or settles at a new stable level, the anomaly recovers and emits a recovery notification.

## Tuning and muting

Anomaly detection is configured per health-check field, with template-level defaults you can override per system assignment. The main knobs:

- **Sensitivity** widens or narrows the band. Higher sensitivity means a wider band and fewer alerts.
- **Confirmation window** sets how many consecutive deviating readings are required before alerting.
- **Baseline window** sets how much history defines "normal".
- **Drift** can be enabled or disabled, and its threshold tuned, independently of spikes.

When an anomaly is noisy or expected, you can quiet it without retuning:

- **Mute notifications** silences alerts for a field or for a whole system while leaving the anomaly visible. A mute is per user.
- **Suppress** hides a single confirmed anomaly from the active feed until the metric moves meaningfully away from the suppressed value again.

## Notifications and the assistant

Confirmed anomalies notify at warning importance and recoveries at info importance, delivered to the system's anomaly subscribers through your configured [notification](/checkstack/user-guide/concepts/notifications/) channels (subject to any mutes). The assistant can list anomalies, filtered by system, state, or kind, when you ask what is behaving unusually.

Anomaly settings can also be declared in Git so detection tuning travels with the rest of your configuration. See the [GitOps entity kinds reference](/checkstack/user-guide/reference/gitops-kinds/).

## Where to go next

- **The metrics it watches.** Read [Health checks](/checkstack/user-guide/concepts/health-checks/) for where these numeric results come from.
- **Who gets alerted.** See [Notifications](/checkstack/user-guide/concepts/notifications/).
- **Act on an anomaly.** Use [Automations](/checkstack/user-guide/concepts/automations/) to react when one is confirmed.
