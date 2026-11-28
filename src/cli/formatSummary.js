// Human-readable output of an import summary (architecture C5).

// One-paragraph human-readable summary.
export function formatSummary(summary) {
  const lines = [
    `Import run ${summary.runId}: ${summary.status}`
      + (summary.stopReason ? ` (${summary.stopReason})` : ''),
    `  offsets:  ${summary.startOffset} -> ${summary.nextOffset}`,
    `  fetched:  ${summary.recordsFetched} raw records in ${summary.pages} page(s)`,
    `  works:    ${summary.inserted} inserted, ${summary.updated} updated, ${summary.unchanged} unchanged`,
    `  skipped:  ${summary.skipped}`,
  ];
  for (const sample of summary.skippedSamples) {
    lines.push(`    offset ${sample.offset} (${sample.recordId ?? 'no id'}): ${sample.reason}`);
  }
  if (summary.error) {
    lines.push(`  error:    ${summary.error}`);
    lines.push(summary.runMarkedFailed
      ? '  The run is marked failed. Continue it with: npm run import -- --resume'
      : '  The run was NOT changed by this process (another process may own it).');
  }
  return lines.join('\n');
}
