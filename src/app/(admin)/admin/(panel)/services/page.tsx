import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { InstantAction } from "@/components/admin/InstantAction";
import { StatusPill, Text } from "@/components/admin/fields";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient, fmtDate, hasPendingChanges, SERVICE_TR_FIELDS } from "@/lib/admin";
import { storageUrl } from "@/lib/media";
import { move, trash } from "../_actions/content";
import { createService, setServiceStatus } from "../_actions/services";

export const metadata = { title: "Services" };

export default async function ServicesList() {
  const user = await requireStaff(can.translate);
  const db = await createSessionClient();
  const { data, error } = await db
    .from("services")
    .select("id,slug,status,sort_order,is_featured,updated_at,show_price,service_translations(*),main:media_assets!services_main_media_id_fkey(bucket,path,variants)")
    .is("deleted_at", null)
    .order("sort_order");
  const canEdit = can.content(user);
  return (
    <>
      <div className="topbar"><div><h1>Services</h1><div className="sub">Each service has its own page at /services/&lt;slug&gt; and appears in service grids.</div></div></div>
      {error ? <div className="flash err">{error.message}</div> : null}
      <section className="panel tight">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th /><th>Service</th><th>Status</th><th>Featured</th><th>Price shown</th><th>Updated</th><th /></tr></thead>
            <tbody>
              {(data ?? []).map((s) => {
                const tr = (s.service_translations as Record<string, string>[]).find((t) => t.variant === "draft" && t.locale === "en") ?? (s.service_translations as Record<string, string>[])[0];
                const main = s.main as unknown as { bucket: string; path: string; variants: Record<string, string> } | null;
                const pending = s.status === "published" && hasPendingChanges(s.service_translations as Record<string, unknown>[], SERVICE_TR_FIELDS);
                return (
                  <tr key={s.id}>
                    <td style={{ width: 80 }}>{main ? <img src={storageUrl(main.bucket, main.variants?.["480"] ?? main.path)} alt="" style={{ width: 72, height: 48, objectFit: "cover", borderRadius: 6 }} /> : <span className="muted small">No image</span>}</td>
                    <td><Link href={`/admin/services/${s.id}`}><strong>{tr?.nav_title ?? tr?.title ?? s.slug}</strong></Link><div className="small muted mono">/services/{s.slug}</div></td>
                    <td><StatusPill status={s.status} pending={pending} /></td>
                    <td>{s.is_featured ? "Yes" : "—"}</td>
                    <td>{s.show_price ? "Yes" : "No"}</td>
                    <td className="small muted">{fmtDate(s.updated_at)}</td>
                    <td className="actions">
                      <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                        <Link className="btn secondary small" href={`/admin/services/${s.id}`}>Edit</Link>
                        {canEdit ? (
                          <>
                            <InstantAction action={move} hidden={{ table: "services", id: s.id, dir: "up" }} title="Move up">↑</InstantAction>
                            <InstantAction action={move} hidden={{ table: "services", id: s.id, dir: "down" }} title="Move down">↓</InstantAction>
                            {s.status !== "published" || pending ? (
                              <ConfirmAction action={setServiceStatus} hidden={{ id: s.id, status: "published" }} label={pending ? "Publish changes" : "Publish"} title="Publish service?" message="The current draft in all languages becomes public." />
                            ) : (
                              <ConfirmAction action={setServiceStatus} hidden={{ id: s.id, status: "draft" }} label="Unpublish" title="Unpublish service?" message="The service page and its cards disappear from the website." />
                            )}
                            {s.status !== "archived" ? <ConfirmAction action={setServiceStatus} hidden={{ id: s.id, status: "archived" }} label="Archive" title="Archive service?" message="Archived services are hidden from the website but kept for reference. You can publish them again later." /> : null}
                            <ConfirmAction action={trash} hidden={{ table: "services", id: s.id }} danger label="Delete" title="Move service to Trash?" message="The service disappears from the website immediately. Restore it from the Trash if needed." confirmLabel="Move to Trash" />
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {canEdit ? (
        <section className="panel">
          <h2>Add a service</h2>
          <ActionForm action={createService} className="form-grid">
            <Text name="title" label="Service title (default language)" required maxLength={160} />
            <Text name="slug" label="URL slug" hint="Leave empty to generate from the title." maxLength={80} />
            <div className="full"><SubmitButton>Create draft service</SubmitButton></div>
          </ActionForm>
        </section>
      ) : null}
    </>
  );
}
