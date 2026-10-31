import type { Slot } from "@/lib/availability/compare";
import type { WebClinic, WebTreatment } from "@/lib/availability/sources/oralcare-se";
import type { MeasurementWindow } from "@/lib/availability/window";

// The two kinds of source a market is measured with (plan 13.3). A new market
// with another booking system adds an EprSource; nothing else changes.

export type Registry = {
  treatments: WebTreatment[];
  /** Clinics patients can choose for each treatment, by the treatment's web key. */
  selectable: Map<string, WebClinic[]>;
  clinics: WebClinic[];
  maxLeadDays: number;
};

export type WebSlotsResult = { kind: "slots"; slots: Slot[] } | { kind: "not-found" };

export interface WebBookingSource {
  readonly key: string;
  readRegistry(): Promise<Registry>;
  /** Asked from "now", so the source applies its own lead time like the booking flow. */
  readSlots(clinicId: string, treatmentKey: string, from: Date, to: Date): Promise<WebSlotsResult>;
}

export interface EprSource {
  readonly key: string;
  readSlots(clinicId: string, procedureId: string, window: MeasurementWindow): Promise<Slot[]>;
  /** Caregiver ids per procedure open for online booking, with or without slots. Counted, never stored. */
  readActivation(clinicId: string): Promise<Map<string, Set<string>>>;
}
