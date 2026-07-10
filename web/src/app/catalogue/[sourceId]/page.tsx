import type { Metadata } from "next";
import StarDetailClient from "./star-client";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sourceId: string }>;
}): Promise<Metadata> {
  const { sourceId } = await params;
  return {
    title: `Gaia DR3 ${sourceId} — slow-VGRF explorer`,
    description: `Full catalogue record and orbit summaries for Gaia DR3 ${sourceId}.`,
  };
}

export default async function StarPage({
  params,
}: {
  params: Promise<{ sourceId: string }>;
}) {
  const { sourceId } = await params;
  return <StarDetailClient sourceId={sourceId} />;
}
