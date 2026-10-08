export function japanDay(date:Date){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  return ['year','month','day'].map(type=>parts.find(part=>part.type===type)!.value).join('-');
}
export const UPSERT=`INSERT INTO daily_counts (day, event, count) VALUES (?, ?, 1)
ON CONFLICT(day, event) DO UPDATE SET count = daily_counts.count + 1`;
