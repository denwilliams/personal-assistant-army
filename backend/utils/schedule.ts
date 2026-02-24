import { CronExpressionParser } from "cron-parser";
import type { Schedule } from "../types/models";

/**
 * Compute the next run time for a schedule after execution.
 * Returns epoch milliseconds or null for one-shot schedules.
 */
export function computeNextRun(schedule: Schedule): number | null {
  const now = Date.now();
  switch (schedule.schedule_type) {
    case "once":
      return null; // No next run for one-shot schedules
    case "interval": {
      const ms = parseInt(schedule.schedule_value);
      // Guard against bad values — enforce minimum 5 minute interval
      const safeMs = isNaN(ms) || ms < 300_000 ? 300_000 : ms;
      return now + safeMs;
    }
    case "cron": {
      const parsed = CronExpressionParser.parse(schedule.schedule_value, {
        currentDate: new Date(now),
        tz: schedule.timezone,
      });
      return parsed.next().getTime();
    }
  }
}

/**
 * Compute the first run time for a newly created schedule.
 * Returns epoch milliseconds or null.
 */
export function computeFirstRun(
  scheduleType: string,
  scheduleValue: string,
  timezone: string
): number | null {
  switch (scheduleType) {
    case "once":
      return new Date(scheduleValue).getTime();
    case "interval": {
      const ms = parseInt(scheduleValue);
      const safeMs = isNaN(ms) || ms < 300_000 ? 300_000 : ms;
      return Date.now() + safeMs;
    }
    case "cron": {
      const parsed = CronExpressionParser.parse(scheduleValue, {
        currentDate: new Date(),
        tz: timezone,
      });
      return parsed.next().getTime();
    }
    default:
      return null;
  }
}
