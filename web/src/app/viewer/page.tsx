import type { Metadata } from "next";
import ViewerClient from "./viewer-client";

export const metadata: Metadata = {
  title: "3D orbit viewer — slow-VGRF explorer",
  description:
    "Integrate 4-Gyr orbits of the slow-VGRF catalogue stars live in the " +
    "paper's galactic potential models.",
};

export default function ViewerPage() {
  return <ViewerClient />;
}
