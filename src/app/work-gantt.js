(function () {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MIN_SPAN_MS = 3 * DAY_MS;

  function asDate(value) {
    if (value == null || value === "") return null;
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function parseDates(ticket) {
    const raw = ticket?.raw ?? {};
    const now = new Date();
    const created = asDate(raw.created_at || raw.createdAt || ticket?.updatedAt) ?? now;
    const due = asDate(raw.due_date || raw.dueDate || raw.milestone?.due_date || raw.milestone?.due_on);
    const closed = asDate(raw.closed_at || raw.completedAt);
    const updated = asDate(ticket?.updatedAt);

    let start = created;
    let end;
    if (due) {
      if (start > due) start = new Date(due.getTime() - 7 * DAY_MS);
      end = due;
    } else if (closed) {
      end = closed;
    } else {
      end = updated ?? now;
    }

    if (end.getTime() - start.getTime() < MIN_SPAN_MS) {
      end = new Date(start.getTime() + MIN_SPAN_MS);
    }
    return { start, end, hasDueDate: !!due };
  }

  function timeBounds(tickets, paddingDays = 7) {
    const pad = Number.isFinite(paddingDays) ? Math.max(0, paddingDays) * DAY_MS : 7 * DAY_MS;
    let min = Infinity;
    let max = -Infinity;
    for (const ticket of tickets ?? []) {
      const { start, end } = parseDates(ticket);
      min = Math.min(min, start.getTime(), end.getTime());
      max = Math.max(max, start.getTime(), end.getTime());
    }
    if (!Number.isFinite(min)) {
      const now = Date.now();
      min = now;
      max = now;
    }
    return { minDate: new Date(min - pad), maxDate: new Date(max + pad) };
  }

  function generateTicks(minDate, maxDate, zoom = "week") {
    const min = asDate(minDate), max = asDate(maxDate);
    if (!min || !max || min > max) return [];
    const unit = zoom === "day" ? "day" : zoom === "month" ? "month" : "week";
    const cursor = new Date(min);
    if (unit === "month") {
      cursor.setDate(1);
    } else if (unit === "week") {
      cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
      cursor.setHours(0, 0, 0, 0);
    } else {
      cursor.setHours(0, 0, 0, 0);
    }

    const ticks = [];
    while (cursor <= max) {
      const date = new Date(cursor);
      const isMajor = unit === "month" || (unit === "week" ? date.getDate() <= 7 : date.getDate() === 1);
      const label = unit === "month"
        ? date.toLocaleDateString(undefined, { month: "short", year: "numeric" })
        : unit === "week"
          ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
          : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      ticks.push({ date, label, isMajor });
      if (unit === "month") cursor.setMonth(cursor.getMonth() + 1);
      else cursor.setDate(cursor.getDate() + (unit === "week" ? 7 : 1));
    }
    return ticks;
  }
  function primaryHeaders(minDate, maxDate, zoom = "week") {
    const min = asDate(minDate), max = asDate(maxDate);
    if (!min || !max || min > max) return [];

    const unit = zoom === "month" ? "year" : "month";
    const cursor = new Date(min);
    if (unit === "year") cursor.setUTCMonth(0, 1);
    else cursor.setUTCDate(1);
    cursor.setUTCHours(0, 0, 0, 0);

    const headers = [];
    while (cursor <= max) {
      const next = new Date(cursor);
      if (unit === "year") next.setUTCFullYear(next.getUTCFullYear() + 1);
      else next.setUTCMonth(next.getUTCMonth() + 1);

      const start = new Date(Math.max(cursor.getTime(), min.getTime()));
      const end = new Date(Math.min(next.getTime(), max.getTime()));
      const date = new Date(cursor);
      headers.push({
        date,
        label: unit === "year"
          ? String(date.getUTCFullYear())
          : date.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }),
        start,
        end,
      });
      cursor.setTime(next.getTime());
    }
    return headers;
  }


  function ticketPosition(dates, minDate, maxDate, totalWidth) {
    const min = asDate(minDate)?.getTime();
    const max = asDate(maxDate)?.getTime();
    const start = asDate(dates?.start)?.getTime();
    const end = asDate(dates?.end)?.getTime();
    const width = Number.isFinite(totalWidth) ? Math.max(0, totalWidth) : 0;
    if (![min, max, start, end].every(Number.isFinite) || max <= min || width === 0) {
      return { left: 0, width: 0 };
    }
    const span = max - min;
    const left = Math.max(0, Math.min(width, ((start - min) / span) * width));
    const right = Math.max(left, Math.min(width, ((end - min) / span) * width));
    return { left, width: right - left };
  }

  function groupBy(tickets, mode = "column", order = []) {
    const groups = new Map();
    for (const ticket of tickets ?? []) {
      const key = mode === "column" ? String(ticket?.column ?? "") : "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ticket);
    }
    const result = Array.from(groups, ([key, groupedTickets]) => ({ key, tickets: groupedTickets }));
    if (mode !== "column" || !Array.isArray(order) || order.length === 0) return result;
    const indices = new Map();
    order.forEach((key, index) => {
      const normalized = String(key);
      if (!indices.has(normalized)) indices.set(normalized, index);
    });
    return result.sort((a, b) => {
      const aIndex = indices.get(a.key), bIndex = indices.get(b.key);
      if (aIndex === undefined) return bIndex === undefined ? 0 : 1;
      if (bIndex === undefined) return -1;
      return aIndex - bIndex;
    });
  }

  const api = { parseDates, timeBounds, generateTicks, primaryHeaders, ticketPosition, groupBy };
  if (typeof window !== "undefined") window.OMP_WORK_GANTT = api;
  if (typeof module !== "undefined") module.exports = api;
})();
