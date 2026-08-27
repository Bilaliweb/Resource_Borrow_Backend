import bcrypt from 'bcryptjs';
import { db } from './prisma';
import { PERMISSIONS } from './shared/src/types';

const SALT_ROUNDS = 12;

async function main() {
  console.log('🌱 Seeding database...\n');

  // Clean existing data (order matters for foreign keys)
  console.log('Cleaning existing data...');
  await db.requestApprovalStep.deleteMany();
  await db.borrowRequest.deleteMany();
  await db.rolePermission.deleteMany();
  await db.userRole.deleteMany();
  await db.approvalWorkflowStep.deleteMany();
  await db.approvalWorkflowTemplate.deleteMany();
  await db.employeeSchedule.deleteMany();
  await db.notification.deleteMany();
  await db.auditLog.deleteMany();
  await db.project.deleteMany();
  await db.role.deleteMany();
  await db.user.deleteMany();
  await db.department.deleteMany();
  await db.organization.deleteMany();
  await db.permission.deleteMany();
  console.log('✓ Cleaned.\n');

  // ---- 1. Create Permissions ----
  console.log('Creating system permissions...');
  for (const [key, desc] of Object.entries(PERMISSIONS)) {
    await db.permission.upsert({
      where: { key },
      update: {},
      create: { key, description: desc },
    });
  }
  const allPermissions = await db.permission.findMany();
  const permByKey = Object.fromEntries(allPermissions.map((p) => [p.key, p.id]));
  console.log(`  ✓ ${allPermissions.length} permissions created.`);

  // ---- 2. Create Organization ----
  console.log('Creating organization...');
  const org = await db.organization.create({
    data: { name: 'Acme Corp', planTier: 'enterprise' },
  });
  console.log(`  ✓ Org: ${org.name} (${org.id})`);

  // ---- 3. Create Roles ----
  console.log('Creating roles...');
  const roleDefs = [
    { name: 'owner', isSystemRole: true },
    { name: 'hr_manager', isSystemRole: true },
    { name: 'department_head', isSystemRole: true },
    { name: 'manager', isSystemRole: true },
    { name: 'employee', isSystemRole: true },
  ] as const;

  const createdRoles: Record<string, string> = {};
  for (const rd of roleDefs) {
    const role = await db.role.create({
      data: { orgId: org.id, name: rd.name, isSystemRole: rd.isSystemRole },
    });
    createdRoles[rd.name] = role.id;
    console.log(`  ✓ Role: ${rd.name} (${role.id})`);
  }

  // ---- 4. Role-Permission Assignments ----
  console.log('Assigning permissions to roles...');
  const rolePerms: Record<string, string[]> = {
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

  for (const [roleName, permKeys] of Object.entries(rolePerms)) {
    const roleId = createdRoles[roleName];
    if (!roleId) continue;
    for (const pk of permKeys) {
      const permId = permByKey[pk];
      if (permId) {
        await db.rolePermission.create({
          data: { roleId, permissionId: permId },
        });
      }
    }
  }
  console.log('  ✓ Permissions assigned.');

  // ---- 5. Create Users ----
  console.log('Creating users...');
  const usersData = [
    { key: 'owner', email: 'alice@acme.com', fullName: 'Alice Johnson', jobTitle: 'CEO', role: 'owner' },
    { key: 'hr_manager', email: 'bob@acme.com', fullName: 'Bob Smith', jobTitle: 'HR Manager', role: 'hr_manager' },
    { key: 'department_head', email: 'carol@acme.com', fullName: 'Carol Williams', jobTitle: 'Dept Head of Engineering', role: 'department_head' },
    { key: 'manager_dave', email: 'dave@acme.com', fullName: 'Dave Brown', jobTitle: 'Engineering Manager', role: 'manager' },
    { key: 'employee_eve', email: 'eve@acme.com', fullName: 'Eve Davis', jobTitle: 'Software Engineer', role: 'employee' },
    { key: 'manager_frank', email: 'frank@acme.com', fullName: 'Frank Miller', jobTitle: 'Marketing Manager', role: 'manager' },
    { key: 'employee_grace', email: 'grace@acme.com', fullName: 'Grace Lee', jobTitle: 'Marketing Specialist', role: 'employee' },
  ];

  const createdUsers: Record<string, { id: string; email: string }> = {};
  for (const ud of usersData) {
    const passwordHash = await bcrypt.hash('Password123!', SALT_ROUNDS);
    const user = await db.user.create({
      data: {
        orgId: org.id,
        email: ud.email,
        passwordHash,
        fullName: ud.fullName,
        jobTitle: ud.jobTitle,
      },
    });
    await db.userRole.create({
      data: { userId: user.id, roleId: createdRoles[ud.role] },
    });
    createdUsers[ud.key] = { id: user.id, email: ud.email };
    console.log(`  ✓ User: ${ud.fullName} (${ud.email}) [${ud.role}]`);
  }

  // ---- 6. Create Departments ----
  console.log('Creating departments...');
  await db.department.create({
    data: {
      orgId: org.id,
      name: 'Engineering',
      headUserId: createdUsers['department_head'].id,
    },
  });
  console.log(`  ✓ Engineering dept (head: Carol)`);

  await db.department.create({
    data: {
      orgId: org.id,
      name: 'Design',
    },
  });
  console.log(`  ✓ Design dept`);

  await db.department.create({
    data: {
      orgId: org.id,
      name: 'Marketing',
      headUserId: createdUsers['manager_frank'].id,
    },
  });
  console.log(`  ✓ Marketing dept (head: Frank)`);

  // ---- 7. Create Projects ----
  console.log('Creating projects...');
  const project1 = await db.project.create({
    data: {
      orgId: org.id,
      name: 'Platform Redesign',
      ownerUserId: createdUsers['manager_dave'].id,
      status: 'active',
    },
  });
  await db.project.create({
    data: {
      orgId: org.id,
      name: 'Mobile App v2',
      ownerUserId: createdUsers['manager_dave'].id,
      status: 'active',
    },
  });
  await db.project.create({
    data: {
      orgId: org.id,
      name: 'Data Pipeline',
      ownerUserId: createdUsers['department_head'].id,
      status: 'active',
    },
  });
  await db.project.create({
    data: {
      orgId: org.id,
      name: 'Brand Refresh 2025',
      ownerUserId: createdUsers['manager_frank'].id,
      status: 'active',
    },
  });
  await db.project.create({
    data: {
      orgId: org.id,
      name: 'Customer Portal',
      ownerUserId: createdUsers['department_head'].id,
      status: 'planning',
    },
  });
  console.log(`  ✓ 5 projects created.`);

  // ---- 8. Create Employee Schedules ----
  console.log('Creating sample employee schedules...');
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0, 0);
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0);
  const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 17, 0, 0);

  await db.employeeSchedule.createMany({
    data: [
      {
        userId: createdUsers['employee_eve'].id,
        orgId: org.id,
        date: todayStart,
        startTime: todayStart,
        endTime: todayMid,
        label: 'Sprint work on Platform Redesign',
        type: 'project_work',
      },
      {
        userId: createdUsers['employee_eve'].id,
        orgId: org.id,
        date: todayMid,
        startTime: todayMid,
        endTime: todayEnd,
        label: 'Team standup & code review',
        type: 'meeting',
      },
      {
        userId: createdUsers['manager_dave'].id,
        orgId: org.id,
        date: todayStart,
        startTime: todayStart,
        endTime: todayEnd,
        label: 'Management & 1-on-1s',
        type: 'project_work',
      },
    ],
  });
  console.log('  ✓ 3 schedule entries created.');

  // ---- 9. Default Approval Workflow Template ----
  console.log('Creating default approval workflow template...');
  const template = await db.approvalWorkflowTemplate.create({
    data: {
      orgId: org.id,
      name: 'Default 4-Step Approval',
      isDefault: true,
      steps: {
        create: [
          { stepOrder: 1, roleRequiredId: createdRoles['manager'], label: 'Current Manager Approval' },
          { stepOrder: 2, roleRequiredId: createdRoles['department_head'], label: 'Department Head Approval' },
          { stepOrder: 3, roleRequiredId: createdRoles['hr_manager'], label: 'HR Approval' },
          { stepOrder: 4, roleRequiredId: createdRoles['owner'], label: 'Final Approval' },
        ],
      },
    },
  });
  console.log(`  ✓ Template: "${template.name}" with ${4} steps.`);

  // ---- 10. Sample Borrow Requests ----
  console.log('Creating sample borrow requests...');

  // Borrow Request 1: Pending
  const now = new Date();
  const startDT = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const endDT = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);

  const br1 = await db.borrowRequest.create({
    data: {
      orgId: org.id,
      requestCode: 'BR-2026-001',
      employeeId: createdUsers['employee_eve'].id,
      fromManagerId: createdUsers['manager_dave'].id,
      toManagerId: createdUsers['department_head'].id,
      projectId: project1.id,
      startDatetime: startDT,
      endDatetime: endDT,
      reason: 'Need Eve on the Platform Redesign project for 1 week to help with frontend architecture decisions and mentor junior developers on React patterns.',
      status: 'pending',
      approvalSteps: {
        create: [
          { stepOrder: 1, roleRequired: 'manager', status: 'pending' },
          { stepOrder: 2, roleRequired: 'department_head', status: 'pending' },
          { stepOrder: 3, roleRequired: 'hr_manager', status: 'pending' },
          { stepOrder: 4, roleRequired: 'owner', status: 'pending' },
        ],
      },
    },
  });
  console.log(`  ✓ BR-2026-001 (pending)`);

  // Borrow Request 2: Active (all steps approved)
  const startDT2 = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const endDT2 = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

  const br2 = await db.borrowRequest.create({
    data: {
      orgId: org.id,
      requestCode: 'BR-2026-002',
      employeeId: createdUsers['employee_eve'].id,
      fromManagerId: createdUsers['manager_dave'].id,
      toManagerId: createdUsers['department_head'].id,
      projectId: project1.id,
      startDatetime: startDT2,
      endDatetime: endDT2,
      reason: 'Borrow Eve to work on critical performance optimization for the Mobile App v2 release. The app has latency issues affecting 15% of users and needs her React Native expertise.',
      status: 'active',
      approvalSteps: {
        create: [
          { stepOrder: 1, roleRequired: 'manager', status: 'approved', approverUserId: createdUsers['manager_dave'].id, comment: 'Approved. Eve is our best resource for this.', resolvedAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
          { stepOrder: 2, roleRequired: 'department_head', status: 'approved', approverUserId: createdUsers['department_head'].id, comment: 'Agreed. Prioritize this over non-critical tasks.', resolvedAt: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000) },
          { stepOrder: 3, roleRequired: 'hr_manager', status: 'approved', approverUserId: createdUsers['hr_manager'].id, comment: 'No conflicts in schedule. Approved.', resolvedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000) },
          { stepOrder: 4, roleRequired: 'owner', status: 'approved', approverUserId: createdUsers['owner'].id, comment: 'Approved. Make it happen!', resolvedAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000) },
        ],
      },
    },
  });
  console.log(`  ✓ BR-2026-002 (active)`);

  // ---- 10b. Additional Employee Schedules for Grace Lee ----
  console.log('Adding Grace Lee schedule entries...');
  const graceScheduleStart1 = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0, 0);
  const graceScheduleEnd1 = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 11, 0, 0);
  const graceScheduleStart2 = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 11, 30, 0);
  const graceScheduleEnd2 = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 13, 0, 0);
  const graceScheduleStart3 = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 14, 0, 0);
  const graceScheduleEnd3 = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 16, 30, 0);

  await db.employeeSchedule.createMany({
    data: [
      {
        userId: createdUsers['employee_grace'].id,
        orgId: org.id,
        date: graceScheduleStart1,
        startTime: graceScheduleStart1,
        endTime: graceScheduleEnd1,
        label: 'Brand asset creation for Q4 campaign',
        type: 'project_work',
      },
      {
        userId: createdUsers['employee_grace'].id,
        orgId: org.id,
        date: graceScheduleStart2,
        startTime: graceScheduleStart2,
        endTime: graceScheduleEnd2,
        label: 'Marketing standup meeting',
        type: 'meeting',
      },
      {
        userId: createdUsers['employee_grace'].id,
        orgId: org.id,
        date: graceScheduleStart3,
        startTime: graceScheduleStart3,
        endTime: graceScheduleEnd3,
        label: 'Customer Portal content review',
        type: 'project_work',
      },
    ],
  });
  console.log('  ✓ 3 schedule entries for Grace Lee.');

  // ---- 10c. Borrow Request 3: Pending (Grace Lee borrowed by Frank for Brand Refresh 2025) ----
  console.log('Creating BR-2026-003...');
  const brandRefreshProject = await db.project.findFirst({
    where: { orgId: org.id, name: 'Brand Refresh 2025' },
  });
  const startDT3 = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  const endDT3 = new Date(now.getTime() + 19 * 24 * 60 * 60 * 1000);

  if (brandRefreshProject) {
    await db.borrowRequest.create({
      data: {
        orgId: org.id,
        requestCode: 'BR-2026-003',
        employeeId: createdUsers['employee_grace'].id,
        fromManagerId: createdUsers['manager_frank'].id,
        toManagerId: createdUsers['manager_frank'].id,
        projectId: brandRefreshProject.id,
        startDatetime: startDT3,
        endDatetime: endDT3,
        reason: 'Need Grace full-time on the Brand Refresh 2025 project for 2 weeks to lead the visual identity redesign and create a comprehensive brand guideline document.',
        status: 'pending',
        approvalSteps: {
          create: [
            { stepOrder: 1, roleRequired: 'manager', status: 'pending' },
            { stepOrder: 2, roleRequired: 'department_head', status: 'pending' },
            { stepOrder: 3, roleRequired: 'hr_manager', status: 'pending' },
            { stepOrder: 4, roleRequired: 'owner', status: 'pending' },
          ],
        },
      },
    });
    console.log(`  ✓ BR-2026-003 (pending) — Grace Lee borrowed by Frank for Brand Refresh 2025`);
  }

  // ---- 10d. Borrow Request 4: Completed ----
  console.log('Creating BR-2026-004...');
  const mobileAppProject = await db.project.findFirst({
    where: { orgId: org.id, name: 'Mobile App v2' },
  });
  const startDT4 = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);
  const endDT4 = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

  if (mobileAppProject) {
    await db.borrowRequest.create({
      data: {
        orgId: org.id,
        requestCode: 'BR-2026-004',
        employeeId: createdUsers['employee_grace'].id,
        fromManagerId: createdUsers['manager_frank'].id,
        toManagerId: createdUsers['department_head'].id,
        projectId: mobileAppProject.id,
        startDatetime: startDT4,
        endDatetime: endDT4,
        reason: 'Grace needed on the Mobile App v2 project to design the onboarding flow and create marketing assets for the app store launch.',
        status: 'completed',
        approvalSteps: {
          create: [
            { stepOrder: 1, roleRequired: 'manager', status: 'approved', approverUserId: createdUsers['manager_frank'].id, comment: 'Grace has great design skills. Approved.', resolvedAt: new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000) },
            { stepOrder: 2, roleRequired: 'department_head', status: 'approved', approverUserId: createdUsers['department_head'].id, comment: 'Approved. Schedule looks clear.', resolvedAt: new Date(now.getTime() - 24 * 24 * 60 * 60 * 1000) },
            { stepOrder: 3, roleRequired: 'hr_manager', status: 'approved', approverUserId: createdUsers['hr_manager'].id, comment: 'Approved.', resolvedAt: new Date(now.getTime() - 23 * 24 * 60 * 60 * 1000) },
            { stepOrder: 4, roleRequired: 'owner', status: 'approved', approverUserId: createdUsers['owner'].id, comment: 'Go ahead!', resolvedAt: new Date(now.getTime() - 22 * 24 * 60 * 60 * 1000) },
          ],
        },
      },
    });
    console.log(`  ✓ BR-2026-004 (completed) — Grace on Mobile App v2`);
  }

  // ---- 10e. Borrow Request 5: Rejected ----
  console.log('Creating BR-2026-005...');
  const dataPipelineProject = await db.project.findFirst({
    where: { orgId: org.id, name: 'Data Pipeline' },
  });
  const startDT5 = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
  const endDT5 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  if (dataPipelineProject) {
    await db.borrowRequest.create({
      data: {
        orgId: org.id,
        requestCode: 'BR-2026-005',
        employeeId: createdUsers['employee_eve'].id,
        fromManagerId: createdUsers['manager_dave'].id,
        toManagerId: createdUsers['department_head'].id,
        projectId: dataPipelineProject.id,
        startDatetime: startDT5,
        endDatetime: endDT5,
        reason: 'Eve requested for the Data Pipeline project to help with real-time data processing module development.',
        status: 'rejected',
        approvalSteps: {
          create: [
            { stepOrder: 1, roleRequired: 'manager', status: 'approved', approverUserId: createdUsers['manager_dave'].id, comment: 'Eve could contribute well here.', resolvedAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000) },
            { stepOrder: 2, roleRequired: 'department_head', status: 'rejected', approverUserId: createdUsers['department_head'].id, comment: 'Cannot spare Eve right now — Platform Redesign deadline is too close.', resolvedAt: new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000) },
            { stepOrder: 3, roleRequired: 'hr_manager', status: 'skipped' },
            { stepOrder: 4, roleRequired: 'owner', status: 'skipped' },
          ],
        },
      },
    });
    console.log(`  ✓ BR-2026-005 (rejected) — Eve on Data Pipeline, rejected at dept head`);
  }

  // ---- Summary ----
  console.log('\n✅ Seed completed successfully!');
  console.log(`
   Organization:  ${org.name}
   Users:         7
   Roles:         5
   Permissions:   ${allPermissions.length}
   Departments:   3
   Projects:      5
   Schedules:     6
   Workflows:     1 template (4 steps)
   Borrow Req:    5 (2 pending, 1 active, 1 completed, 1 rejected)

   Test Accounts:
     alice@acme.com    / Password123!  (owner)
     bob@acme.com      / Password123!  (hr_manager)
     carol@acme.com    / Password123!  (department_head)
     dave@acme.com     / Password123!  (manager)
     eve@acme.com      / Password123!  (employee)
     frank@acme.com    / Password123!  (manager)
     grace@acme.com    / Password123!  (employee)
`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
