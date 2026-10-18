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

export const admins = pgTable(
  'admins',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(), // always stored lowercased
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ['SUPER_ADMIN', 'FACULTY_ADMIN'] }).notNull(),
    facultyId: integer('faculty_id').references(() => faculties.id),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('admins_role_check', sql`${t.role} IN ('SUPER_ADMIN','FACULTY_ADMIN')`),
    check(
      'admins_role_faculty_check',
      sql`(${t.role} = 'SUPER_ADMIN' AND ${t.facultyId} IS NULL) OR (${t.role} = 'FACULTY_ADMIN' AND ${t.facultyId} IS NOT NULL)`,
    ),
  ],
);

export const holidays = pgTable(
  'holidays',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    title: text('title').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    createdBy: integer('created_by')
      .notNull()
      .references(() => admins.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('holidays_title_length', sql`char_length(${t.title}) BETWEEN 1 AND 100`),
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
    holidayId: bigint('holiday_id', { mode: 'number' })
      .notNull()
      .references(() => holidays.id),
    before: jsonb('before'),
    after: jsonb('after'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('audit_log_action_check', sql`${t.action} IN ('CREATE','UPDATE','DELETE','RESTORE')`),
  ],
);
