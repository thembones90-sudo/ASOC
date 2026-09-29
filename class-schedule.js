// CLASS SCHEDULE
// The single definition of when class happens, shared by the server-side warning
// broadcast and the test suite so the timetable cannot drift between them.
//
// Classes run on the half hour from 08:00 to 15:30 (the last one ends at 16:00).
// The warning is due in the 60 seconds BEFORE a start, which is why this module
// keys the warning on the class it is warning about rather than on "what minute is
// it right now". A tick that was throttled, suspended or asleep can come back at
// any point inside that window and still recognise the same pending warning, and
// the caller dedupes on the key so it is announced exactly once.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AsocClassSchedule = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // First class start hour and last class start hour, inclusive. 8..15 gives
  // 08:00 through 15:30 at a half-hour cadence.
  const FIRST_START_HOUR = 8;
  const LAST_START_HOUR = 15;
  // How long before a start the warning is live.
  const WARNING_LEAD_MS = 60 * 1000;

  const pad = value => String(value).padStart(2, '0');

  function classStartsOnDay(date) {
    const starts = [];
    for (let hour = FIRST_START_HOUR; hour <= LAST_START_HOUR; hour += 1) {
      starts.push(new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0, 0, 0));
      starts.push(new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 30, 0, 0));
    }
    return starts;
  }

  // Stable identity for one class, independent of when it is observed. The
  // server keeps only the last key it announced, so a restart mid-window
  // re-announces once rather than staying silent.
  function classKey(start) {
    return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T${pad(start.getHours())}:${pad(start.getMinutes())}`;
  }

  function formatClock(start) {
    return `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  }

  // The warning due at `now`, or null. Only the class starting within the next
  // 60 seconds qualifies, so the warning always reads as "one minute out".
  function classWarningFor(now) {
    for (const start of classStartsOnDay(now)) {
      const lead = start.getTime() - now.getTime();
      if (lead > 0 && lead <= WARNING_LEAD_MS) {
        return { key: classKey(start), label: formatClock(start), startAt: start.getTime() };
      }
    }
    return null;
  }

  function nextClassStart(now) {
    return classStartsOnDay(now).find(start => start.getTime() > now.getTime()) || null;
  }

  return {
    WARNING_LEAD_MS,
    classStartsOnDay,
    classWarningFor,
    classKey,
    formatClock,
    nextClassStart
  };
});
