import type { Metadata } from "next";
import FiguresClient from "./figures-client";

export const metadata: Metadata = {
  title: "Ensemble figures — slow-VGRF explorer",
  description:
    "Interactive versions of the key figures of the slow-VGRF catalogue paper.",
};

export default function FiguresPage() {
  return <FiguresClient />;
}
