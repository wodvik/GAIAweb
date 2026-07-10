import type { Metadata } from "next";
import CatalogueClient from "./catalogue-client";

export const metadata: Metadata = {
  title: "Catalogue browser — slow-VGRF explorer",
  description:
    "Browse, filter and search the 20,829-source Gaia DR3 slow-VGRF candidate pool.",
};

export default function CataloguePage() {
  return <CatalogueClient />;
}
