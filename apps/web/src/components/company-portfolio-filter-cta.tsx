import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { companyProductsFilterUrl } from "@/lib/catalog-links";
import { useLanguage } from "@/lib/i18n";

/** Opens the filterable /company-products collection from a company profile. */
export function CompanyPortfolioFilterCta({
  companyName,
}: {
  companyName?: string | null;
}) {
  const { t } = useLanguage();
  const name = String(companyName || "").trim();
  if (!name) return null;

  return (
    <Button asChild variant="outline" size="sm" className="shrink-0 rounded-xl">
      <a href={companyProductsFilterUrl(name)}>
        <Building2 className="mr-1.5 h-4 w-4" />
        {t("Filter catalog", "تصفية الكتالوج")}
      </a>
    </Button>
  );
}
