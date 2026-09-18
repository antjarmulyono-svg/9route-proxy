import ClientActivityTab from "../components/ClientActivityTab";

export const metadata = {
  title: "Client Activity & Monitoring | 9Router",
  description: "Realtime client requests and traffic monitoring with interactive time-series charts",
};

export default function ClientActivityPage() {
  return (
    <div className="flex flex-col gap-6">
      <ClientActivityTab />
    </div>
  );
}
