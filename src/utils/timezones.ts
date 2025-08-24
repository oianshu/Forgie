// A curated list of IANA time zone identifiers. For full list, autocomplete will filter.
export const IANATimezones: string[] = [
  'Pacific/Midway','Pacific/Honolulu','America/Anchorage','America/Los_Angeles','America/Tijuana',
  'America/Denver','America/Phoenix','America/Chicago','America/Mexico_City','America/New_York',
  'America/Bogota','America/Lima','America/Caracas','America/Santiago','America/Sao_Paulo',
  'Atlantic/Azores','Europe/London','Europe/Dublin','Europe/Lisbon','Africa/Casablanca',
  'Europe/Paris','Europe/Berlin','Europe/Madrid','Europe/Rome','Europe/Amsterdam',
  'Europe/Brussels','Europe/Vienna','Europe/Prague','Europe/Warsaw','Europe/Budapest',
  'Europe/Stockholm','Europe/Copenhagen','Europe/Zurich','Europe/Oslo','Europe/Helsinki',
  'Europe/Athens','Europe/Bucharest','Europe/Sofia','Europe/Kiev','Europe/Minsk',
  'Europe/Moscow','Europe/Istanbul','Asia/Jerusalem','Asia/Beirut','Asia/Baghdad',
  'Asia/Tehran','Asia/Dubai','Asia/Baku','Asia/Tbilisi','Asia/Yerevan',
  'Asia/Kabul','Asia/Karachi','Asia/Tashkent','Asia/Almaty','Asia/Kolkata',
  'Asia/Colombo','Asia/Kathmandu','Asia/Dhaka','Asia/Yangon','Asia/Bangkok',
  'Asia/Jakarta','Asia/Shanghai','Asia/Hong_Kong','Asia/Taipei','Asia/Singapore',
  'Asia/Manila','Asia/Seoul','Asia/Tokyo','Australia/Darwin','Australia/Adelaide',
  'Australia/Sydney','Australia/Melbourne','Australia/Brisbane','Pacific/Guam','Pacific/Port_Moresby',
  'Pacific/Auckland','Pacific/Fiji','Pacific/Tongatapu','Africa/Abidjan','Africa/Accra',
  'Africa/Lagos','Africa/Johannesburg','Africa/Nairobi','Indian/Maldives','Indian/Mauritius',
  'America/Toronto','America/Vancouver','America/Halifax','America/St_Johns','America/Winnipeg',
  'America/Edmonton','America/Guatemala','America/Costa_Rica','America/Panama','America/Kingston',
  'America/La_Paz','America/Asuncion','America/Montevideo','America/Argentina/Buenos_Aires',
  'America/El_Salvador','America/Managua','America/Tegucigalpa','America/Havana','America/Nassau',
  'America/Barbados','America/Port_of_Spain','America/Curacao','America/Aruba','America/Puerto_Rico',
  'Atlantic/Bermuda','Atlantic/Cape_Verde','Africa/Cairo','Africa/Tripoli','Africa/Khartoum',
  'Africa/Addis_Ababa','Africa/Dar_es_Salaam','Africa/Kampala','Africa/Harare','Africa/Gaborone',
  'Africa/Windhoek','Asia/Riyadh','Asia/Muscat','Asia/Kuwait','Asia/Qatar','Asia/Bahrain',
  'Asia/Amman','Asia/Damascus','Asia/Aden','Asia/Sana','Asia/Novosibirsk',
  'Asia/Krasnoyarsk','Asia/Irkutsk','Asia/Yakutsk','Asia/Vladivostok','Asia/Magadan',
  'Asia/Kamchatka','Pacific/Chatham','Pacific/Apia','Pacific/Noumea','Pacific/Norfolk'
];

export function isValidIanaTz(tz: string): boolean {
  return IANATimezones.includes(tz);
}

export function suggestTimezones(query: string, limit = 25): string[] {
  const q = query.toLowerCase();
  const starts = IANATimezones.filter(t => t.toLowerCase().startsWith(q));
  const contains = IANATimezones.filter(t => !starts.includes(t) && t.toLowerCase().includes(q));
  return [...starts, ...contains].slice(0, limit);
}
