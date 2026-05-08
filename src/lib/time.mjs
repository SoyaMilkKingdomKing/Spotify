export function getZonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

export function getLocalDateKey(date, timeZone) {
  const parts = getZonedParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function getDatePrefix(date, timeZone) {
  const parts = getZonedParts(date, timeZone);
  return `${parts.month}.${parts.day}`;
}

export function shouldRunForLocalHour(date, timeZone, targetHour) {
  return getZonedParts(date, timeZone).hour === targetHour;
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function diffDays(a, b) {
  return (a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000);
}
