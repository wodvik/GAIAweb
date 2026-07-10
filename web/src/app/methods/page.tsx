import type { Metadata } from "next";
import MethodsClient from "./methods-client";

export const metadata: Metadata = {
  title: "Methods, step by step — slow-VGRF explorer",
  description:
    "From five Gaia numbers to a catalogue probability: the exact pipeline " +
    "of the slow-VGRF catalogue with live numbers for real stars.",
};

export default function MethodsPage() {
  return <MethodsClient />;
}
