import { IncidentWorkspace } from "@/components/incident/incident-workspace";

export default async function IncidentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <IncidentWorkspace incidentId={id} />;
}