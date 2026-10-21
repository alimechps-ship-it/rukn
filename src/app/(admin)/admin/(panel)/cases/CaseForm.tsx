import { Select, Text, TextArea } from "@/components/admin/fields";
import { ARCHES, COUNTRIES, SEXES } from "@/lib/cases";

export interface CaseFormValues {
  agent_id?: string | null;
  assigned_to?: string | null;
  service_id?: string | null;
  priority?: string | null;
  clinic_name?: string | null;
  doctor_name?: string | null;
  doctor_phone?: string | null;
  doctor_email?: string | null;
  country_code?: string | null;
  city?: string | null;
  patient_ref?: string | null;
  patient_age?: number | null;
  patient_sex?: string | null;
  arches?: string | null;
  description?: string | null;
  due_date?: string | null;
}

export function CaseFormFields({
  v = {}, services, agents, staffUsers, isStaff, disabled = false,
}: {
  v?: CaseFormValues;
  services: { id: string; label: string }[];
  agents?: { id: string; label: string }[];
  staffUsers?: { id: string; label: string }[];
  isStaff: boolean;
  disabled?: boolean;
}) {
  return (
    <>
      {isStaff && agents ? (
        <div className="form-grid" style={{ marginBottom: 14 }}>
          <Select name="agent_id" label="Agent *" defaultValue={v.agent_id ?? ""} disabled={disabled}
            options={[{ value: "", label: "— choose agent —" }, ...agents.map((a) => ({ value: a.id, label: a.label }))]} />
          {staffUsers ? (
            <Select name="assigned_to" label="Case manager (RUKN)" defaultValue={v.assigned_to ?? ""} disabled={disabled}
              options={[{ value: "", label: "Unassigned" }, ...staffUsers.map((a) => ({ value: a.id, label: a.label }))]} />
          ) : <div />}
        </div>
      ) : null}
      <h3>Service · الخدمة</h3>
      <div className="form-grid">
        <Select name="service_id" label="Requested service" defaultValue={v.service_id ?? ""} disabled={disabled}
          options={[{ value: "", label: "— choose service —" }, ...services.map((s) => ({ value: s.id, label: s.label }))]} />
        <Select name="priority" label="Priority" defaultValue={v.priority ?? "normal"} disabled={disabled}
          options={[{ value: "normal", label: "Normal" }, { value: "urgent", label: "Urgent" }]} />
        <Text name="due_date" label="Requested by (date)" type="date" defaultValue={v.due_date ?? ""} disabled={disabled} />
      </div>
      <h3 style={{ marginTop: 18 }}>Clinic & treating doctor · العيادة والطبيب المعالج</h3>
      <div className="form-grid">
        <Text name="clinic_name" label="Clinic / laboratory" required defaultValue={v.clinic_name} disabled={disabled} maxLength={160} />
        <Text name="doctor_name" label="Treating doctor" required defaultValue={v.doctor_name} disabled={disabled} maxLength={120} />
        <Text name="doctor_phone" label="Doctor phone" type="tel" defaultValue={v.doctor_phone} disabled={disabled} maxLength={40} />
        <Text name="doctor_email" label="Doctor e-mail" type="email" defaultValue={v.doctor_email} disabled={disabled} maxLength={200} />
        <Select name="country_code" label="Country *" defaultValue={v.country_code ?? ""} disabled={disabled}
          options={[{ value: "", label: "— choose country —" }, ...COUNTRIES.map(([c, n]) => ({ value: c, label: `${n} (${c})` }))]} />
        <Text name="city" label="City" defaultValue={v.city} disabled={disabled} maxLength={80} />
      </div>
      <h3 style={{ marginTop: 18 }}>Patient · المريض</h3>
      <div className="form-grid">
        <Text name="patient_ref" label="Patient reference" required defaultValue={v.patient_ref} disabled={disabled} maxLength={60}
          hint="Initials or the clinic's file number — not the full name (data minimisation)." />
        <Text name="patient_age" label="Age" type="number" defaultValue={v.patient_age ?? ""} disabled={disabled} />
        <Select name="patient_sex" label="Sex" defaultValue={v.patient_sex ?? ""} disabled={disabled}
          options={[{ value: "", label: "—" }, ...Object.entries(SEXES).map(([k, s]) => ({ value: k, label: s.en }))]} />
        <Select name="arches" label="Arches" defaultValue={v.arches ?? ""} disabled={disabled}
          options={[{ value: "", label: "—" }, ...Object.entries(ARCHES).map(([k, s]) => ({ value: k, label: s.en }))]} />
        <TextArea name="description" label="Clinical notes / chief complaint / doctor's instructions" defaultValue={v.description} disabled={disabled} rows={5} maxLength={4000} />
      </div>
    </>
  );
}
