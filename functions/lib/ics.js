/**
 * Minimal iCalendar builder for the announcement email.
 *
 * A calendar attachment is the single cheapest thing that moves
 * show-rate. People who put it on the calendar turn up; people who
 * mean to remember do not.
 */
const stamp = (date) => new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

const escape = (text) =>
  String(text || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// RFC 5545 caps lines at 75 octets; long descriptions must be folded.
const fold = (line) => {
  if (line.length <= 73) return line;
  const parts = [line.slice(0, 73)];
  let rest = line.slice(73);
  while (rest.length > 72) {
    parts.push(' ' + rest.slice(0, 72));
    rest = rest.slice(72);
  }
  if (rest) parts.push(' ' + rest);
  return parts.join('\r\n');
};

export function buildIcs({ sessions = [], name, description, url, organizerEmail, uidBase }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The One Percent Nation//Class//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];

  sessions.forEach((session, i) => {
    // Guard on the raw value first. new Date(null) is epoch zero,
    // not NaN, so a dateless session would otherwise emit a
    // calendar event in 1970.
    if (!session.startsAt) return;
    const start = new Date(session.startsAt);
    if (Number.isNaN(start.getTime())) return;
    const minutes = Number(session.durationMinutes) || 90;
    const end = new Date(start.getTime() + minutes * 60000);

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uidBase}-${i + 1}@the1pnation.com`,
      `DTSTAMP:${stamp(Date.now())}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      fold(`SUMMARY:${escape(session.title ? `${name}: ${session.title}` : name)}`),
      fold(`DESCRIPTION:${escape(description)}`),
      fold(`URL:${escape(url)}`),
      fold(`LOCATION:${escape(session.location || url)}`),
      organizerEmail ? `ORGANIZER:mailto:${organizerEmail}` : null,
      'BEGIN:VALARM',
      'TRIGGER:-PT1H',
      'ACTION:DISPLAY',
      fold(`DESCRIPTION:${escape(name)} starts in one hour`),
      'END:VALARM',
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return lines.filter(Boolean).join('\r\n');
}
