"use client";
import type { UnitApiCase } from "../lib/eval-api";
import styles from "./unit-history-layout.module.css";

export function RecordedUnitCase({ record }: { record: UnitApiCase }) {
  const metrics = [
    ...new Set([
      ...Object.keys(record.scores ?? {}),
      ...Object.keys(record.thresholds ?? {}),
    ]),
  ];
  return (
    <div className={styles.caseEvidence}>
      <strong>
        {record.case_id} · Recorded verdict: {record.verdict}
      </strong>
      <p>
        Case verdicts and metric thresholds are recorded evidence, not an
        inferred root cause. Missing scores or thresholds remain unknown.
      </p>
      {!!metrics.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Recorded score</th>
                <th>Recorded minimum</th>
                <th>Threshold check</th>
                <th>Recorded explanation</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => {
                const score = record.scores?.[metric],
                  threshold = record.thresholds?.[metric];
                const known =
                  ["passed", "failed"].includes(record.verdict) &&
                  typeof score === "number" &&
                  Number.isFinite(score) &&
                  typeof threshold === "number" &&
                  Number.isFinite(threshold);
                return (
                  <tr key={metric}>
                    <th scope="row">{metric}</th>
                    <td>{score ?? "Not recorded"}</td>
                    <td>{threshold ?? "Not recorded"}</td>
                    <td>
                      {known
                        ? score >= threshold
                          ? "Met"
                          : "Below minimum"
                        : "Unknown"}
                    </td>
                    <td>
                      {record.score_explanations?.[metric] ?? "Not recorded"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!metrics.length && <p>No metric scores or thresholds were recorded.</p>}
      {record.error && (
        <>
          <h3>Recorded error</h3>
          <pre className={styles.recordedText}>{record.error}</pre>
        </>
      )}
      <div className={styles.evidenceColumns}>
        <details>
          <summary>Expected response</summary>
          <pre className={styles.recordedText}>
            {record.expected_response ?? "Not recorded"}
          </pre>
        </details>
        <details>
          <summary>Recorded response</summary>
          <pre className={styles.recordedText}>
            {record.response ?? "Not recorded"}
          </pre>
        </details>
        <details>
          <summary>Validation output</summary>
          <pre className={styles.recordedText}>
            {record.validation_result == null
              ? "Not recorded"
              : JSON.stringify(record.validation_result, null, 2)}
          </pre>
        </details>
        <details>
          <summary>Recorded tool calls</summary>
          <pre className={styles.recordedText}>
            {record.tool_calls?.length
              ? JSON.stringify(record.tool_calls, null, 2)
              : "Not recorded"}
          </pre>
        </details>
      </div>
    </div>
  );
}

