export const DEFAULT_FEMALE_PERCENTAGE = 15;

export const DEFAULT_STUDENT_COUNTS: Record<string, number> = {
  CE: 180,
  EEE: 180,
  ME: 180,
  CSE: 180,
  IPE: 60,
  ETE: 60,
  CME: 60,
  URP: 60,
  ECE: 60,
  MTE: 60,
  MSE: 60,
  ARCH: 30,
  CHE: 30,
  ChE: 30,
  BECM: 30,
};

export function getDepartmentStudentCount(code: string, fallback?: number): number {
  const normalized = code.trim().toUpperCase();
  for (const [key, val] of Object.entries(DEFAULT_STUDENT_COUNTS)) {
    if (key.toUpperCase() === normalized) return val;
  }
  return fallback ?? 60;
}

