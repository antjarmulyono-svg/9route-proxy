import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components";
import ClientsPageClient from "./ClientsPageClient";

export const metadata = {
  title: "Client Connections | 9Router",
  description: "Monitor and manage connected client IPs across CLI and MITM tools",
};

export default function ClientsPage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <ClientsPageClient />
    </Suspense>
  );
}
