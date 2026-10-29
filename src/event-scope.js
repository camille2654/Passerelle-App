import {digest} from './store.js';

// Stable across a token refresh, isolated across accounts, pupils and schools.
export const eventScope = user => digest(JSON.stringify([user.id,user.studentId||null,user.schoolName||null]));
export function schoolEvents(user) {
  return user.eventSuggestionsScope===eventScope(user) ? Object.values(user.schoolEventCalendar||{}) : [];
}
