import { ClipboardList } from "lucide-react";
import RoleLoginPage from "@/components/RoleLoginPage";

const ResidentLogin = () => (
  <RoleLoginPage
    roleName="Resident Portal"
    roleKey="resident"
    icon={ClipboardList}
    accentClass="bg-success/20 text-success-ink"
    dashboardPath="/resident/dashboard"
    description="Resident Portal Login"
  />
);

export default ResidentLogin;
