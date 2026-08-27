import { db } from '../prisma';

const TOTAL_HOURS = 8; // 9am-5pm workday
const BUSY_TYPES = ['project_work', 'meeting'];

// ============================================================
// Get employee availability for a given date
// ============================================================
export async function getEmployeeAvailability(
  userId: string,
  orgId: string,
  date?: string,
) {
  // Use provided date or default to today
  const targetDate = date ? new Date(date) : new Date();

  // Normalize to start of day for comparison
  const dayStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  const dayEnd = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59, 999);

  // Query schedules for the user on the given date
  const schedules = await db.employeeSchedule.findMany({
    where: {
      userId,
      orgId,
      date: {
        gte: dayStart,
        lte: dayEnd,
      },
    },
    orderBy: { startTime: 'asc' },
  });

  // If no schedules, return 100% availability
  if (schedules.length === 0) {
    return {
      userId,
      availableHours: TOTAL_HOURS,
      totalHours: TOTAL_HOURS,
      availabilityPercent: 100,
      todaySchedule: [],
    };
  }

  // Calculate busy hours
  let busyHours = 0;
  for (const schedule of schedules) {
    if (BUSY_TYPES.includes(schedule.type)) {
      const start = new Date(schedule.startTime).getTime();
      const end = new Date(schedule.endTime).getTime();
      const hours = (end - start) / (1000 * 60 * 60);
      busyHours += hours;
    }
  }

  const availableHours = Math.max(0, TOTAL_HOURS - busyHours);
  const availabilityPercent = Math.round((availableHours / TOTAL_HOURS) * 100);

  // Map schedules to response format
  const todaySchedule = schedules.map((s) => ({
    id: s.id,
    startTime: s.startTime,
    endTime: s.endTime,
    label: s.label,
    type: s.type,
    isBusy: BUSY_TYPES.includes(s.type),
  }));

  return {
    userId,
    availableHours: Math.round(availableHours * 100) / 100,
    totalHours: TOTAL_HOURS,
    availabilityPercent,
    todaySchedule,
  };
}
