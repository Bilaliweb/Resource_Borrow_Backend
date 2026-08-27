import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../prisma';
import { config } from '../config';
import { PERMISSIONS } from '../shared/src/types';

const SALT_ROUNDS = 12;

const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  owner: Object.keys(PERMISSIONS),
  hr_manager: [
    'borrow_request.create',
    'borrow_request.view',
    'borrow_request.approve.hr',
    'user.manage',
    'user.invite',
    'reporting.view',
    'audit.view',
  ],
  department_head: [
    'borrow_request.create',
    'borrow_request.view',
    'borrow_request.approve.dept_head',
    'reporting.view',
  ],
  manager: [
    'borrow_request.create',
    'borrow_request.view',
    'borrow_request.approve.current_manager',
  ],
  employee: [
    'borrow_request.create',
    'borrow_request.view',
    'borrow_request.cancel',
  ],
};

async function createDefaultWorkflowTemplate(orgId: string, roleIds: Record<string, string>) {
  const template = await db.approvalWorkflowTemplate.create({
    data: {
      orgId,
      name: 'Default 4-Step Approval',
      isDefault: true,
      steps: {
        create: [
          { stepOrder: 1, roleRequiredId: roleIds['manager'], label: 'Current Manager Approval' },
          { stepOrder: 2, roleRequiredId: roleIds['dept_head'], label: 'Department Head Approval' },
          { stepOrder: 3, roleRequiredId: roleIds['hr_manager'], label: 'HR Approval' },
          { stepOrder: 4, roleRequiredId: roleIds['owner'], label: 'Final Approval' },
        ],
      },
    },
  });
  return template;
}

function generateToken(userId: string, orgId: string, roles: string[]) {
  return jwt.sign({ userId, orgId, roles }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
}

export async function register(data: {
  orgName: string;
  fullName: string;
  email: string;
  password: string;
}) {
  const { orgName, fullName, email, password } = data;

  // Check if org with this name already exists (simple guard)
  const existingOrgs = await db.organization.findMany({ where: { name: orgName }, take: 1 });
  if (existingOrgs.length > 0) {
    throw { statusCode: 409, message: 'An organization with this name already exists.' };
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // Create org
  const org = await db.organization.create({
    data: { name: orgName, planTier: 'starter' },
  });

  // Ensure all system permissions exist (idempotent upsert)
  for (const [key, desc] of Object.entries(PERMISSIONS)) {
    await db.permission.upsert({
      where: { key },
      update: {},
      create: { key, description: desc },
    });
  }

  // Create roles for the org
  const roleNames = ['owner', 'hr_manager', 'dept_head', 'manager', 'employee'] as const;
  const roleIds: Record<string, string> = {};

  for (const name of roleNames) {
    const role = await db.role.create({
      data: {
        orgId: org.id,
        name,
        isSystemRole: true,
      },
    });
    roleIds[name] = role.id;
  }

  // Assign default permissions to roles
  for (const [roleName, permKeys] of Object.entries(DEFAULT_PERMISSIONS)) {
    const roleId = roleIds[roleName];
    if (!roleId) continue;

    for (const permKey of permKeys) {
      const perm = await db.permission.findUnique({ where: { key: permKey } });
      if (perm) {
        await db.rolePermission.create({
          data: { roleId, permissionId: perm.id },
        });
      }
    }
  }

  // Create owner user
  const user = await db.user.create({
    data: {
      orgId: org.id,
      email,
      passwordHash,
      fullName,
      jobTitle: 'Owner',
    },
  });

  // Assign owner role
  await db.userRole.create({
    data: { userId: user.id, roleId: roleIds['owner'] },
  });

  // Create default approval workflow template
  await createDefaultWorkflowTemplate(org.id, roleIds);

  const token = generateToken(user.id, org.id, ['owner']);

  return {
    user: {
      id: user.id,
      orgId: user.orgId,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      jobTitle: user.jobTitle,
      isActive: user.isActive,
      createdAt: user.createdAt,
      roles: ['owner'],
    },
    accessToken: token,
  };
}

export async function login(data: { email: string; password: string }) {
  const { email, password } = data;

  const user = await db.user.findFirst({
    where: { email },
    include: {
      roles: {
        include: { role: true },
      },
    },
  });
  console.log('User from db: ', user);
  

  if (!user) {
    throw { statusCode: 401, message: 'Invalid email or password.' };
  }

  if (!user.isActive) {
    throw { statusCode: 401, message: 'Account is deactivated. Contact your administrator.' };
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    throw { statusCode: 401, message: 'Invalid email or password.' };
  }

  const roles = user.roles.map((ur) => ur.role.name);
  const token = generateToken(user.id, user.orgId, roles);

  return {
    user: {
      id: user.id,
      orgId: user.orgId,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      jobTitle: user.jobTitle,
      isActive: user.isActive,
      createdAt: user.createdAt,
      roles,
    },
    accessToken: token,
  };
}
