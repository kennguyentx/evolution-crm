// lib/ics.ts — generate iCalendar (.ics) content for LOI deadlines

export function generateLoiIcs(params: {
  dealId: string
  companyName: string
  loiDate: string   // YYYY-MM-DD
  dealUrl: string
}): string {
  const { dealId, companyName, loiDate, dealUrl } = params

  // Convert YYYY-MM-DD to YYYYMMDD for iCal
  const dateStamp = loiDate.replace(/-/g, '')

  // Day after for DTEND (all-day events are exclusive end)
  const endDate = new Date(loiDate + 'T12:00:00')
  endDate.setDate(endDate.getDate() + 1)
  const endStamp = endDate.toISOString().split('T')[0].replace(/-/g, '')

  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Evolution Strategy Partners//Nexus CRM//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:loi-${dealId}@nexus.evolutionstrategy.com`,
    `DTSTAMP:${now}`,
    `DTSTART;VALUE=DATE:${dateStamp}`,
    `DTEND;VALUE=DATE:${endStamp}`,
    `SUMMARY:LOI Due: ${companyName}`,
    `DESCRIPTION:LOI deadline for ${companyName}\\n${dealUrl}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    `DESCRIPTION:LOI due tomorrow: ${companyName}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

export function icsAttachment(ics: string, filename = 'loi-deadline.ics') {
  return {
    Name: filename,
    Content: Buffer.from(ics).toString('base64'),
    ContentType: 'text/calendar; charset=utf-8; method=REQUEST',
  }
}
