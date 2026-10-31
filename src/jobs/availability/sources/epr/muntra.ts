import type { Slot } from "@/lib/availability/compare";
import { activatedProcedures, readMuntraPage, type MuntraPage } from "@/lib/availability/sources/muntra";
import { splitForMuntra, type MeasurementWindow } from "@/lib/availability/window";

import { SourceRequestError, type SourceClient } from "../../../runtime/http";
import type { EprSource } from "../types";

// Muntra's public API, with the same parameters oralcare.se uses (plan 6.2).
// A response that reaches the page cap fails the read; it is never cut short.

const API = "https://api.muntra.com/api/muntra-caregiver-at-locations";
const PAGE_CAP = 20;

const utc = (date: Date) => date.toISOString().slice(0, 19);

export class Muntra implements EprSource {
  readonly key = "muntra";

  constructor(private readonly client: SourceClient) {}

  async readSlots(clinicId: string, procedureId: string, window: MeasurementWindow): Promise<Slot[]> {
    const slots: Slot[] = [];
    for (const part of splitForMuntra(window)) {
      const pages = await this.pages({
        clinic_id: clinicId,
        procedure_ids: procedureId,
        new_patient: "true",
        dtstart: utc(part.from),
        dtend: utc(part.to),
        include: "clinic,free_bookable_slots,procedures.procedure",
      });
      for (const page of pages) {
        for (const caregiver of page.caregivers) {
          for (const start of caregiver.slotStarts) {
            slots.push({ start: new Date(start), caregiverId: caregiver.caregiverId, procedureId });
          }
        }
      }
    }
    // A slot on the border of two parts can appear twice.
    return [...new Map(slots.map((s) => [`${s.caregiverId}|${s.start.getTime()}`, s])).values()];
  }

  async readActivation(clinicId: string): Promise<Map<string, Set<string>>> {
    return activatedProcedures(await this.pages({ clinic_id: clinicId, include: "procedures.procedure" }));
  }

  private async pages(params: Record<string, string>): Promise<MuntraPage[]> {
    const pages: MuntraPage[] = [];
    for (let page = 1; ; page++) {
      const query = new URLSearchParams({ ...params, per_page: "100", page: String(page) });
      const response = await this.client.get(`${API}?${query}`, "json");
      if (response.status !== 200) throw new SourceRequestError("muntra", `http_${response.status}`);
      const parsed = readMuntraPage(JSON.parse(response.body));
      pages.push(parsed);
      if (parsed.totalPages >= PAGE_CAP) throw new SourceRequestError("muntra", "page_cap");
      if (page >= parsed.totalPages) return pages;
    }
  }
}
