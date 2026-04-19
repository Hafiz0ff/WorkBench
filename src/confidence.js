function clamp01(value) {
  if (!Number.isFinite(Number(value))) {
    return null;
  }
  return Math.min(1, Math.max(0, Number(value)));
}

function formatPercent(score) {
  const safe = clamp01(score);
  return safe === null ? null : Math.round(safe * 100);
}

function getLogprobEntries(raw) {
  const choices = Array.isArray(raw?.choices) ? raw.choices : [];
  const logprobs = choices[0]?.logprobs?.content;
  if (!Array.isArray(logprobs) || !logprobs.length) {
    return [];
  }
  return logprobs
    .map((entry) => ({
      token: String(entry?.token || ''),
      logprob: Number(entry?.logprob),
    }))
    .filter((entry) => Number.isFinite(entry.logprob));
}

export function confidenceFromLogprobs(raw) {
  const entries = getLogprobEntries(raw);
  if (!entries.length) {
    return null;
  }

  const meanLogprob = entries.reduce((sum, entry) => sum + entry.logprob, 0) / entries.length;
  const score = clamp01(Math.exp(meanLogprob));
  if (score === null) {
    return null;
  }

  const percent = formatPercent(score);
  const label = score >= 0.85
    ? 'high'
    : score >= 0.65
      ? 'medium'
      : 'low';

  return {
    score,
    percent,
    label,
    source: 'logprobs',
    tokenCount: entries.length,
    averageLogprob: meanLogprob,
    warning: score < 0.65 ? 'Низкая уверенность: текст стоит перепроверить.' : null,
  };
}

export function confidenceFromRaw(raw) {
  return confidenceFromLogprobs(raw);
}

export function confidenceClass(score) {
  const safe = clamp01(score);
  if (safe === null) {
    return 'confidence-unknown';
  }
  if (safe >= 0.85) {
    return 'confidence-high';
  }
  if (safe >= 0.65) {
    return 'confidence-medium';
  }
  return 'confidence-low';
}

export function confidenceLabel(score) {
  const safe = clamp01(score);
  if (safe === null) {
    return 'Confidence n/a';
  }
  if (safe >= 0.85) {
    return 'High confidence';
  }
  if (safe >= 0.65) {
    return 'Medium confidence';
  }
  return 'Low confidence';
}

export function confidencePercent(score) {
  return formatPercent(score);
}
