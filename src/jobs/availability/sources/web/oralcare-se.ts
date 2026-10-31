import {
  readBookingPage,
  readClinicList,
  readClinicsForTreatment,
  readMaxLeadDays,
  readSlots,
} from "@/lib/availability/sources/oralcare-se";

import { SourceRequestError, type SourceClient } from "../../../runtime/http";
import type { Registry, WebBookingSource, WebSlotsResult } from "../types";

// oralcare.se, read like the booking flow reads it (plan 6.2).

const BASE = "https://www.oralcare.se";

export class OralcareSe implements WebBookingSource {
  readonly key = "oralcare_se";

  constructor(private readonly client: SourceClient) {}

  async readRegistry(): Promise<Registry> {
    const menu = readBookingPage(await this.page("/boka"));
    const selectable = new Map([[menu.active.internalKey, menu.clinics]]);
    for (const treatment of menu.treatments) {
      if (treatment.internalKey === menu.active.internalKey) continue;
      const html = await this.page(`/boka?treatment=${encodeURIComponent(treatment.slug)}`);
      selectable.set(treatment.internalKey, readClinicsForTreatment(html, treatment.slug));
    }
    const clinics = readClinicList(await this.page("/kliniker"));
    // readClinicList fails on an empty list, so there is always a first clinic.
    const maxLeadDays = readMaxLeadDays(
      await this.page(`/boka/tid?clinic=${encodeURIComponent(clinics[0]!.slug)}`),
    );
    return { treatments: menu.treatments, selectable, clinics, maxLeadDays };
  }

  async readSlots(clinicId: string, treatmentKey: string, from: Date, to: Date): Promise<WebSlotsResult> {
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      treatmentWebKey: treatmentKey,
      clinicIds: clinicId,
    });
    const response = await this.client.get(`${BASE}/api/bookings/getSlots?${params}`, "json");
    // 404: the treatment is withdrawn or inactive (plan 6.2). 400 is a fault in the collector.
    if (response.status === 404) return { kind: "not-found" };
    if (response.status !== 200) throw new SourceRequestError("oralcare_se", `http_${response.status}`);
    const slots = readSlots(JSON.parse(response.body));
    return {
      kind: "slots",
      slots: slots
        .filter((s) => s.clinicId === clinicId)
        .map((s) => ({
          start: new Date(s.start),
          caregiverId: s.caregiverId,
          procedureId: s.treatmentEprId,
        })),
    };
  }

  private async page(path: string): Promise<string> {
    const response = await this.client.get(`${BASE}${path}`, "html");
    if (response.status !== 200) throw new SourceRequestError("oralcare_se", `http_${response.status}`);
    return response.body;
  }
}
