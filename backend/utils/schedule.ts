import { CronExpressionParser } from "cron-parser";
import type { Schedule } from "../types/models";

/**
 * Compute the next run time for a schedule after execution
 */
export function computeNextRun(schedule: Schedule): Date | null {
  const now = new Date();
  switch (schedule.schedule_type) {
    case "once":
      return null; // No next run for one-shot schedules
    case "interval": {
      const ms = parseInt(schedule.schedule_value);
      // Guard against bad values — enforce minimum 5 minute interval
      const safeMs = isNaN(ms) || ms < 300_000 ? 300_000 : ms;
      return new Date(now.getTime() + safeMs);
    }
    case "cron": {
      const parsed = CronExpressionParser.parse(schedule.schedule_value, {
        currentDate: now,
        tz: schedule.timezone,
      });
      return parsed.next().toDate();
    }
  }
}

/**
 * Compute the first run time for a newly created schedule
 */
export function computeFirstRun(
  scheduleType: string,
  scheduleValue: string,
  timezone: string
): Date | null {
  switch (scheduleType) {
    case "once":
      return new Date(scheduleValue);
    case "interval": {
      const ms = parseInt(scheduleValue);
      const safeMs = isNaN(ms) || ms < 300_000 ? 300_000 : ms;
      return new Date(Date.now() + safeMs);
    }
    case "cron": {
      const parsed = CronExpressionParser.parse(scheduleValue, {
        currentDate: new Date(),
        tz: timezone,
      });
      return parsed.next().toDate();
    }
    default:
      return null;
  }
}
