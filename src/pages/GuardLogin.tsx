import { ScanLine } from "lucide-react";
import RoleLoginPage from "@/components/RoleLoginPage";

const GuardLogin = () => (
  <RoleLoginPage
    roleName="Security Guard"
    roleKey="guard"
    icon={ScanLine}
    accentClass="bg-primary/20 text-primary-ink"
    dashboardPath="/guard/dashboard"
    description="Security Guard Login"
  />
);

export default GuardLogin;
