import ClientsPageClient from "./ClientsPageClient";

export const metadata = {
  title: "Client Connections | 9Router",
  description: "Monitor and manage connected client IPs across CLI and MITM tools",
};

export default function ClientsPage() {
  return <ClientsPageClient />;
}
