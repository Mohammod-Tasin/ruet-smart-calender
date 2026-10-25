import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import type { RuleParams } from '../../core/calendar/rules';

export const faculties = pgTable('faculties', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const departments = pgTable('departments', {
  id: serial('id').primaryKey(),
  facultyId: integer('faculty_id')
    .notNull()
    .references(() => faculties.id),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
});

export const series = pgTable(
  'series',
  {
    id: serial('id').primaryKey(),
    departmentId: integer('department_id')
      .notNull()
      .references(() => departments.id),
    intakeYear: integer('intake_year').notNull(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    unique().on(t.departmentId, t.intakeYear),
    check('series_intake_year_range', sql`${t.intakeYear} BETWEEN 2000 AND 2100`),
  ],
);

export const admins = pgTable('admins', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(), // always stored lowercased
  passwordHash: text('password_hash').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const holidays = pgTable(
  'holidays',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    title: text('title').notNull(),
    note: text('note'), // the "why"; shown in details and in overlap warnings
    category: text('category').notNull().default('HOLIDAY'),
    classesOnly: boolean('classes_only').notNull().default(false), // offices open, classes closed
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    createdBy: integer('created_by')
      .notNull()
      .references(() => admins.id),
    updatedBy: integer('updated_by')
      .notNull()
      .references(() => admins.id), // = created_by on insert
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('holidays_title_length', sql`char_length(${t.title}) BETWEEN 1 AND 100`),
    check('holidays_note_length', sql`${t.note} IS NULL OR char_length(${t.note}) <= 500`),
    check('holidays_date_order', sql`${t.endDate} >= ${t.startDate}`),
    index('holidays_range_idx')
      .on(t.startDate, t.endDate)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const holidayAudience = pgTable(
  'holiday_audience',
  {
    holidayId: bigint('holiday_id', { mode: 'number' }).notNull(),
    scopeType: text('scope_type', { enum: ['ALL', 'FACULTY', 'DEPARTMENT', 'SERIES'] }).notNull(),
    scopeId: integer('scope_id'),
  },
  (t) => [
    foreignKey({ columns: [t.holidayId], foreignColumns: [holidays.id] }).onDelete('cascade'),
    check(
      'holiday_audience_scope_type_check',
      sql`${t.scopeType} IN ('ALL','FACULTY','DEPARTMENT','SERIES')`,
    ),
    check(
      'holiday_audience_scope_id_check',
      sql`(${t.scopeType} = 'ALL') = (${t.scopeId} IS NULL)`,
    ),
    unique().on(t.holidayId, t.scopeType, t.scopeId).nullsNotDistinct(),
  ],
);

/** Recurring holidays, expanded on the fly per year. See CLAUDE.md §13. */
export const holidayRules = pgTable(
  'holiday_rules',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    category: text('category').notNull().default('HOLIDAY'),
    classesOnly: boolean('classes_only').notNull().default(false),
    kind: text('kind', { enum: ['GREGORIAN_FIXED', 'HIJRI', 'MANUAL_YEARLY'] }).notNull(),
    params: jsonb('params').$type<RuleParams>().notNull(),
    effectiveFromYear: integer('effective_from_year').notNull(),
    effectiveToYear: integer('effective_to_year'),
    createdBy: integer('created_by')
      .notNull()
      .references(() => admins.id),
    updatedBy: integer('updated_by')
      .notNull()
      .references(() => admins.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('holiday_rules_title_length', sql`char_length(${t.title}) BETWEEN 1 AND 100`),
    check(
      'holiday_rules_kind_check',
      sql`${t.kind} IN ('GREGORIAN_FIXED','HIJRI','MANUAL_YEARLY')`,
    ),
    check(
      'holiday_rules_years_check',
      sql`${t.effectiveToYear} IS NULL OR ${t.effectiveToYear} >= ${t.effectiveFromYear}`,
    ),
  ],
);

export const holidayRuleAudience = pgTable(
  'holiday_rule_audience',
  {
    ruleId: integer('rule_id').notNull(),
    scopeType: text('scope_type', { enum: ['ALL', 'FACULTY', 'DEPARTMENT', 'SERIES'] }).notNull(),
    scopeId: integer('scope_id'),
  },
  (t) => [
    foreignKey({ columns: [t.ruleId], foreignColumns: [holidayRules.id] }).onDelete('cascade'),
    check(
      'holiday_rule_audience_scope_type_check',
      sql`${t.scopeType} IN ('ALL','FACULTY','DEPARTMENT','SERIES')`,
    ),
    check(
      'holiday_rule_audience_scope_id_check',
      sql`(${t.scopeType} = 'ALL') = (${t.scopeId} IS NULL)`,
    ),
    unique().on(t.ruleId, t.scopeType, t.scopeId).nullsNotDistinct(),
  ],
);

export const holidayRuleOverrides = pgTable(
  'holiday_rule_overrides',
  {
    ruleId: integer('rule_id')
      .notNull()
      .references(() => holidayRules.id),
    year: integer('year').notNull(),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    skipped: boolean('skipped').notNull().default(false),
    confirmed: boolean('confirmed').notNull().default(false),
    note: text('note'),
    updatedBy: integer('updated_by')
      .notNull()
      .references(() => admins.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.ruleId, t.year),
    check(
      'holiday_rule_overrides_dates_check',
      sql`(${t.startDate} IS NULL) = (${t.endDate} IS NULL) AND (${t.startDate} IS NULL OR ${t.endDate} >= ${t.startDate})`,
    ),
  ],
);

export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(), // sha256 hex; raw token lives only in the cookie
  adminId: integer('admin_id')
    .notNull()
    .references(() => admins.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const loginAttempts = pgTable('login_attempts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  email: text('email').notNull(),
  ip: text('ip').notNull(),
  success: boolean('success').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    adminId: integer('admin_id')
      .notNull()
      .references(() => admins.id),
    action: text('action', { enum: ['CREATE', 'UPDATE', 'DELETE', 'RESTORE'] }).notNull(),
    holidayId: bigint('holiday_id', { mode: 'number' }).references(() => holidays.id), // HOLIDAY rows only
    entityType: text('entity_type').notNull().default('HOLIDAY'), // HOLIDAY | RULE | RULE_OVERRIDE
    entityId: bigint('entity_id', { mode: 'number' }).notNull(), // rule id for RULE_OVERRIDE
    before: jsonb('before'),
    after: jsonb('after'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('audit_log_action_check', sql`${t.action} IN ('CREATE','UPDATE','DELETE','RESTORE')`),
  ],
);
