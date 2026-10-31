// The schema version this code needs (plan 7). Raise it in the same change as
// a migration that sets core.schema_state.schema_version to the same number.
export const REQUIRED_SCHEMA = 1;

export type SchemaState = { schemaVersion: number; minCodeSchema: number };

/** The database may be newer than the code, never older (expand and contract). */
export function schemaFits(state: SchemaState, required: number = REQUIRED_SCHEMA): boolean {
  return state.schemaVersion >= required && required >= state.minCodeSchema;
}
