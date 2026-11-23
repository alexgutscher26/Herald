/**
 * Setup checklist shapes shared by the server loader and the overview view.
 *
 * The checklist is derived from stored records on every request; it is not a
 * client-side to-do list, so a step cannot be ticked without the work existing.
 */

export type SetupStep = {
  id: string;
  label: string;
  /** What to do, shown while the step is outstanding. */
  description: string;
  /** What exists already, shown once the step is complete. */
  detail: string;
  done: boolean;
  href: string;
};

export type SetupChecklist = {
  steps: SetupStep[];
  completed: number;
  total: number;
};
