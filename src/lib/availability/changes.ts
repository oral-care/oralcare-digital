import { t } from "@/lib/messages";

// Changes in the offering as text (plan 6.5): one line per change, with the
// names the clinic and treatment had last. The daily summary lists them and
// the charts show them at their day. Pure module.

/** The columns a change is read with, from availability.change_event as e. */
export const CHANGE_COLUMNS = `e.kind,
  (SELECT n.name FROM core.clinic_name n WHERE n.clinic_id = e.clinic_id ORDER BY lower(n.valid_during) DESC LIMIT 1) AS clinic,
  (SELECT n.name FROM core.treatment_name n WHERE n.treatment_id = e.treatment_id ORDER BY lower(n.valid_during) DESC LIMIT 1) AS treatment,
  e.before, e.after,
  (SELECT r.name FROM core.region r WHERE r.country_id = e.country_id AND r.key = e.before->>'region') AS region_before,
  (SELECT r.name FROM core.region r WHERE r.country_id = e.country_id AND r.key = e.after->>'region') AS region_after`;

export type ChangeRow = {
  kind: string;
  clinic: string | null;
  treatment: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  region_before: string | null;
  region_after: string | null;
};

export function changeLine(row: ChangeRow): string {
  const clinic = row.clinic ?? "";
  const treatment = row.treatment ?? String(row.before?.name ?? row.after?.name ?? "");
  const key = (kind: string) => `email.summary.changeKinds.${kind}`;
  switch (row.kind) {
    case "treatment_renamed":
      return t(key(row.kind), {
        before: String(row.before?.name ?? ""),
        after: String(row.after?.name ?? ""),
      });
    case "clinic_region_changed":
      return t(key(row.kind), { clinic, before: row.region_before ?? "", after: row.region_after ?? "" });
    case "selectable_changed":
      return t(key(row.after?.selectable ? "selectable_on" : "selectable_off"), { clinic, treatment });
    case "epr_activation_changed":
      return t(key(row.after?.activated ? "epr_activation_on" : "epr_activation_off"), {
        clinic,
        treatment,
      });
    case "max_lead_changed":
      return t(key(row.kind), {
        before: Number(row.before?.days ?? 0),
        after: Number(row.after?.days ?? 0),
      });
    default:
      return t(key(row.kind), { clinic, treatment });
  }
}
