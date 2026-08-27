// ============================================================
// Resource Borrow Platform — Shared Type Definitions
// ============================================================

// ---- Enums ----

export type PlanTier = 'starter' | 'growth' | 'enterprise';

export type BorrowRequestStatus =
  | 'pending'
  | 'approved'
  | 'active'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export type ApprovalStepStatus = 'pending' | 'approved' | 'rejected' | 'skipped';

export type ScheduleType = 'project_work' | 'meeting' | 'available' | 'leave';

export type NotificationType =
  | 'request_submitted'
  | 'approval_needed'
  | 'approval_progress'
  | 'request_approved'
  | 'request_rejected'
  | 'request_active'
  | 'request_completed'
  | 'request_cancelled';

export type UserRoleName = 'owner' | 'hr_manager' | 'department_head' | 'manager' | 'employee';

// ---- Core Entities ----

export interface Organization {
  id: string;
  name: string;
  planTier: PlanTier;
  createdAt: Date;
}

export interface User {
  id: string;
  orgId: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  isActive: boolean;
  createdAt: Date;
  roles?: UserRoleName[];
  department?: Department;
}

export interface Role {
  id: string;
  orgId: string;
  name: UserRoleName;
  isSystemRole: boolean;
  permissions?: Permission[];
}

export interface Permission {
  id: string;
  key: string;
  description?: string;
}

export interface Department {
  id: string;
  orgId: string;
  name: string;
  headUserId: string | null;
}

export interface Project {
  id: string;
  orgId: string;
  name: string;
  ownerUserId: string;
  status: string;
}

export interface EmployeeSchedule {
  id: string;
  userId: string;
  orgId: string;
  date: string;
  startTime: string;
  endTime: string;
  label: string;
  type: ScheduleType;
}

export interface BorrowRequest {
  id: string;
  orgId: string;
  requestCode: string;
  employeeId: string;
  fromManagerId: string;
  toManagerId: string;
  projectId: string;
  startDatetime: Date;
  endDatetime: Date;
  reason: string;
  status: BorrowRequestStatus;
  createdAt: Date;
  updatedAt: Date;
  // Populated relations
  employee?: User;
  fromManager?: User;
  toManager?: User;
  project?: Project;
  approvalSteps?: RequestApprovalStep[];
}

export interface ApprovalWorkflowTemplate {
  id: string;
  orgId: string;
  name: string;
  isDefault: boolean;
  steps?: ApprovalWorkflowStep[];
}

export interface ApprovalWorkflowStep {
  id: string;
  templateId: string;
  stepOrder: number;
  roleRequiredId: string;
  label: string;
}

export interface RequestApprovalStep {
  id: string;
  borrowRequestId: string;
  stepOrder: number;
  approverUserId: string | null;
  roleRequired: string;
  status: ApprovalStepStatus;
  comment: string | null;
  resolvedAt: Date | null;
  // Populated relations
   approver?: User;
}

export interface Notification {
  id: string;
  orgId: string;
  userId: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  isRead: boolean;
  createdAt: Date;
}

export interface AuditLog {
  id: string;
  orgId: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

// ---- API Types ----

export interface JwtPayload {
  userId: string;
  orgId: string;
  roles: UserRoleName[];
  iat: number;
  exp: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: User;
  accessToken: string;
}

export interface RegisterRequest {
  orgName: string;
  fullName: string;
  email: string;
  password: string;
}

export interface RegisterResponse {
  user: User;
  accessToken: string;
}

export interface CreateBorrowRequest {
  employeeId: string;
  projectId: string;
  startDatetime: string;
  endDatetime: string;
  reason: string;
}

export interface ApprovalAction {
  stepId: string;
  decision: 'approved' | 'rejected';
  comment?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  statusCode: number;
  message: string;
  errors?: Record<string, string[]>;
}

// ---- Dashboard KPIs ----

export interface DashboardKpis {
  totalRequests: number;
  pendingRequests: number;
  activeRequests: number;
  completedRequests: number;
 totalThisMonth: number;
}

// ---- Availability ----

export interface EmployeeAvailability {
  userId: string;
  availableHours: number;
  totalHours: number;
  availabilityPercent: number;
  todaySchedule: ScheduleBlock[];
}

export interface ScheduleBlock {
  id: string;
  startTime: string;
  endTime: string;
  label: string;
  type: ScheduleType;
  isBusy: boolean;
}

// ---- Permissions ----

export const PERMISSIONS = {
  // Borrow requests
  'borrow_request.create': 'Create borrow requests',
  'borrow_request.view': 'View borrow requests',
  'borrow_request.cancel': 'Cancel own borrow requests',
  'borrow_request.approve.current_manager': 'Approve as current manager',
  'borrow_request.approve.dept_head': 'Approve as department head',
  'borrow_request.approve.hr': 'Approve as HR manager',
  'borrow_request.approve.final': 'Final approval (CEO/Director)',

  // User management
  'user.manage': 'Manage organization users',
  'user.invite': 'Invite new users',

  // Org management
  'org.manage': 'Manage organization settings',
  'org.billing': 'Manage billing',

  // Workflow templates
  'workflow_template.manage': 'Manage approval workflow templates',

  // Reporting
  'reporting.view': 'View reports',

  // Audit
  'audit.view': 'View audit logs',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

// ---- Status Color Mapping ----

export const STATUS_CONFIG: Record<BorrowRequestStatus, { color: string; bg: string; label: string }> = {
  pending:  { color: '#F59E0B', bg: '#FEF3C7', label: 'Pending' },
  approved: { color: '#10B981', bg: '#DCFCE7', label: 'Approved' },
  active:   { color: '#10B981', bg: '#D1FAE5', label: 'Active' },
  completed:{ color: '#3B82F6', bg: '#DBEAFE', label: 'Completed' },
  rejected: { color: '#EF4444', bg: '#FEE2E2', label: 'Rejected' },
  cancelled:{ color: '#9CA3AF', bg: '#F3F4F6', label: 'Cancelled' },
};
