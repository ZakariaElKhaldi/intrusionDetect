import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ObservationPrediction } from "../../types";
import { comparePrediction, ObservationResults } from "./ObservationResults";

function prediction(overrides: Partial<ObservationPrediction> = {}): ObservationPrediction {
  return {
    prediction_id: "prediction-1",
    event_id: "event-1",
    detector_model_version: "detector-v1",
    classifier_model_version: null,
    binary_prediction: "normal",
    attack_class: null,
    detection_score: 0.1,
    alert_id: null,
    ...overrides,
  };
}

describe("ObservationResults", () => {
  it("recognizes canonical RT-IoT2022 normal labels", () => {
    expect(comparePrediction(prediction(), { Attack_type: "MQTT_Publish" })).toMatchObject({
      truthBinary: "normal",
      detectorMatch: true,
      needsReview: false,
    });
  });

  it("separates detector and family discrepancies and filters review work", () => {
    const response = {
      predictions: [
        prediction(),
        prediction({ prediction_id: "prediction-2", event_id: "event-2", binary_prediction: "attack", attack_class: "Port_Scan", classifier_model_version: "classifier-v1", detection_score: 0.9, attack_class_score: 0.6, alert_id: "alert-2" }),
        prediction({ prediction_id: "prediction-3", event_id: "event-3", binary_prediction: "normal", detection_score: 0.4 }),
      ],
    };
    render(<ObservationResults completedMode="immediate" response={response} rows={[{ Attack_type: "MQTT_Publish" }, { Attack_type: "DDoS_UDP" }, { Attack_type: "DOS_SYN_Hping" }]} />);

    expect(screen.getByText("Detector discrepancies").nextSibling).toHaveTextContent("1");
    expect(screen.getByText("Family discrepancies").nextSibling).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: /Needs review 2/ }));
    expect(screen.getByText("Showing 2 results")).toBeInTheDocument();
    expect(screen.getAllByText("Needs review")).toHaveLength(2);
    expect(screen.queryByText("Row 1")).not.toBeInTheDocument();
  });

  it("presents durable acceptance and duplicate counts", () => {
    render(<ObservationResults completedMode="durable" rows={[]} response={{ batch_id: "batch-1", events: [
      { event_id: "event-1", state: "queued", disposition: "accepted" },
      { event_id: "event-2", state: "succeeded", disposition: "duplicate" },
    ] }} />);

    expect(screen.getByText("2 observations received")).toBeInTheDocument();
    expect(screen.getByText("Duplicates").nextSibling).toHaveTextContent("1");
    expect(screen.getByText("Inspect exact receipt")).toBeInTheDocument();
  });
});
