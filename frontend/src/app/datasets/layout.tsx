import type { Metadata } from "next";
export const metadata: Metadata = { title: "Datasets" };
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
