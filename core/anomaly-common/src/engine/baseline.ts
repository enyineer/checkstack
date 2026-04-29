export function computeMean(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

export function computeStdDev(values: number[], mean?: number): number {
  if (values.length <= 1) return 0;
  const m = mean ?? computeMean(values);
  const variance = values.reduce((sq, n) => sq + Math.pow(n - m, 2), 0) / values.length;
  return Math.sqrt(variance);
}

export function computeLinearRegressionSlope(values: number[]): number {
  if (values.length <= 1) return 0;
  // x = index, y = value
  const n = values.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }

  const denominator = (n * sumXX - sumX * sumX);
  if (denominator === 0) return 0;
  
  return (n * sumXY - sumX * sumY) / denominator;
}

export function computeDominance(values: (string | boolean | number)[]): { dominantValue?: string | boolean | number, dominantRatio?: number } {
  if (values.length === 0) return {};
  
  const counts = new Map<string | boolean | number, number>();
  let maxCount = 0;
  let dominantValue: string | boolean | number | undefined = undefined;

  for (const v of values) {
    const count = (counts.get(v) || 0) + 1;
    counts.set(v, count);
    if (count > maxCount) {
      maxCount = count;
      dominantValue = v;
    }
  }

  return {
    dominantValue,
    dominantRatio: maxCount / values.length,
  };
}
