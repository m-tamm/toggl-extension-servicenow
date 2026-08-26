export const STORAGE_KEYS = {
  togglToken: "togglApiToken",
  superProductivityToken: "superProductivityApiToken",
  togglCache: "togglDayCache",
  superProductivityCache: "superProductivityDayCache",
  activeProvider: "activeTrackerProvider"
};

export const TRACKER_PROVIDER = {
  toggl: "toggl",
  superProductivity: "super-productivity"
};

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const SERVICENOW_TARGET = {
  importInputId: "task_time_worked.u_from",
  targetIframeId: "gsft_main",
  durationHoursInputId: "ni.task_time_worked.time_workeddur_hour",
  durationMinutesInputId: "ni.task_time_worked.time_workeddur_min",
  durationSecondsInputId: "ni.task_time_worked.time_workeddur_sec",
  externalNoteTextareaId: "task_time_worked.u_time_booking_external_note",
  rateTypeSelectId: "sys_select.task_time_worked.rate_type",
  rateCategorySelectId: "task_time_worked.u_rate_type_category"
};

export const RATE_TYPE_VALUES = {
  administrative: "43007796db2c41108e647806f4961932",
  businessSolution: "40407b96db2c41108e647806f496192b",
  presales: "2490bb96db2c41108e647806f4961990",
  billable: "bf507b96db2c41108e647806f496192f"
};

export const RATE_CATEGORY_VALUES = {
  administrative: "administrative Tätigkeiten",
  trainingColleagues: "Ausbildung",
  meetings: "Fachspezifische Meetings",
  learning: "Weiterbildung",
  businessSolution: "Business Solution",
  presales: "Presales",
  billable: "abrechnen"
};

// Business mapping: first matching tag determines the ServiceNow rate selection.
export const TAG_TO_CATEGORY = {
  admin: RATE_CATEGORY_VALUES.administrative,
  train: RATE_CATEGORY_VALUES.trainingColleagues,
  ausbildung: RATE_CATEGORY_VALUES.trainingColleagues,
  meet: RATE_CATEGORY_VALUES.meetings,
  "internes meeting": RATE_CATEGORY_VALUES.meetings,
  learn: RATE_CATEGORY_VALUES.learning,
  fortbildung: RATE_CATEGORY_VALUES.learning,
  presales: RATE_CATEGORY_VALUES.presales,
  "kunden/projekttermin": RATE_CATEGORY_VALUES.businessSolution,
  "b-solution": RATE_CATEGORY_VALUES.businessSolution,
  abrechenbar: RATE_CATEGORY_VALUES.billable,
  code: RATE_CATEGORY_VALUES.businessSolution,
  dev: RATE_CATEGORY_VALUES.businessSolution
};
