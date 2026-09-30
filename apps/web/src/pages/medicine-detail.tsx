import { useRoute } from "wouter";
import MedicineDetailPage from "./medicine-detail-page";
import { MedicineObservedCompanionsPanel } from "@/components/medicine-observed-companions-panel";

export default function MedicineDetail() {
  const [, p1] = useRoute("/medicines/:id");
  const [, p2] = useRoute("/drug/:id");
  const [, p3] = useRoute("/catalog/:id");
  const [, p4] = useRoute("/medicine/:id");
  const catalogId = String(
    p1?.id || p2?.id || p3?.id || p4?.id || "",
  );

  return (
    <>
      <MedicineDetailPage />
      <MedicineObservedCompanionsPanel catalogId={catalogId} />
    </>
  );
}
