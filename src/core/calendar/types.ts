export type ScopeType = 'ALL' | 'FACULTY' | 'DEPARTMENT' | 'SERIES';

/** One raw audience row of a holiday. `scopeId` is null only for ALL. */
export interface AudienceEntry {
  scopeType: ScopeType;
  scopeId: number | null;
}

export interface FacultyInfo {
  id: number;
  code: string;
  /** Full name, e.g. "Electrical & Computer Engineering". */
  name?: string;
  sortOrder: number;
}

export interface DepartmentInfo {
  id: number;
  facultyId: number;
  code: string;
}

export interface SeriesInfo {
  id: number;
  departmentId: number;
  intakeYear: number;
  isActive: boolean;
}

export interface Structure {
  faculties: FacultyInfo[];
  departments: DepartmentInfo[];
  series: SeriesInfo[];
}
