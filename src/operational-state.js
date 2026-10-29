export const accountActive = user => !!user && !user.suspendedAt && !user.archivedAt;
export function maintenanceState(settings = {}, now = Date.now()) {
  const mode = settings.maintenance;
  return mode?.enabled === true && mode.until > now ? {enabled: true, until: mode.until, message: mode.message || 'Une maintenance est en cours. Vos données restent consultables.'} : {enabled: false, until: null, message: ''};
}
export function automationAllowed(settings, source, now = Date.now()) {
  return !maintenanceState(settings, now).enabled && settings?.automationPaused?.[source] !== true;
}
export function publicOperations(settings = {}, now = Date.now()) {
  const banner = settings.announcement, announcement = banner && banner.startsAt <= now && banner.until > now ? {id: banner.id, title: banner.title, message: banner.message, tone: banner.tone, until: banner.until} : null;
  return {maintenance: maintenanceState(settings, now), announcement, automationPaused:Object.fromEntries(['ent','pronote','mail','push'].map(source=>[source,settings.automationPaused?.[source]===true])), version: settings.siteVersion || 0};
}
