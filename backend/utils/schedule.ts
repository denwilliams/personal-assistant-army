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
      return new Date(now.getTime() + ms);
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
    case "interval":
      return new Date(Date.now() + parseInt(scheduleValue));
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
