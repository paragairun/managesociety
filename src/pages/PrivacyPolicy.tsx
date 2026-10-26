import { Link } from "react-router-dom";
import { Building2 } from "lucide-react";
import { APP_NAME, SUPPORT_EMAIL } from "@/lib/app-url";

const LAST_UPDATED = "10 July 2026";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mb-8">
    <h2 className="text-lg font-semibold text-foreground mb-3">{title}</h2>
    <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">{children}</div>
  </section>
);

const PrivacyPolicy = () => (
  <div className="min-h-screen bg-background">
    <header className="border-b border-border">
      <div className="max-w-3xl mx-auto px-4 h-16 flex items-center gap-2">
        <Building2 className="h-5 w-5 text-primary" />
        <Link to="/" className="font-bold text-foreground">{APP_NAME}</Link>
      </div>
    </header>

    <main className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold text-foreground mb-2">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground mb-10">Last updated: {LAST_UPDATED}</p>

      <p className="text-sm text-muted-foreground leading-relaxed mb-8">
        {APP_NAME} ("we", "our", "the app") provides digital visitor, vehicle, staff, delivery,
        maintenance billing, and amenity management for residential housing societies in India.
        This policy explains what information we collect through our website and mobile apps
        (resident and guard), why we collect it, and how it's handled.
      </p>

      <Section title="Information We Collect">
        <p>Depending on your role (resident, guard, or society admin), we may collect:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><span className="text-foreground font-medium">Identity information:</span> name, email address, phone number</li>
          <li><span className="text-foreground font-medium">Residence information:</span> society, wing, and flat number; flat area (for maintenance billing)</li>
          <li><span className="text-foreground font-medium">Vehicle information:</span> registration numbers of vehicles you register</li>
          <li><span className="text-foreground font-medium">Photographs:</span> ID photos for registered staff and house help; photos captured for delivery/visitor verification at the gate</li>
          <li><span className="text-foreground font-medium">Financial records:</span> maintenance bill amounts and payment records entered by your society admin (we do not process card or bank payments directly — all payments are recorded manually)</li>
          <li><span className="text-foreground font-medium">Activity records:</span> entry/exit logs, guest passes issued, delivery approvals, amenity bookings</li>
          <li><span className="text-foreground font-medium">Device information:</span> a push notification token, if you enable notifications in our mobile apps, used only to deliver notifications to your device</li>
        </ul>
      </Section>

      <Section title="How We Use This Information">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>To operate core features: gate security, visitor/vehicle verification, staff attendance, delivery approvals, maintenance billing, and amenity booking</li>
          <li>To send you notifications relevant to your role (e.g. a delivery awaiting approval, a booking confirmation, a new bill)</li>
          <li>To notify your society's administrators of new registration requests</li>
        </ul>
      </Section>

      <Section title="Who Can See Your Information">
        <p>
          Your information is only visible to people with a legitimate role in your specific society —
          your society's admins, security guards, and (for shared spaces like your flat) other residents
          of your own flat. Data is strictly isolated between different societies using our platform;
          no society can see another society's data.
        </p>
      </Section>

      <Section title="Third-Party Services We Use">
        <p>We rely on the following service providers to operate the app. Each processes data only as needed to provide their service to us:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><span className="text-foreground font-medium">Supabase</span> — database hosting and user authentication</li>
          <li><span className="text-foreground font-medium">Resend</span> — sending transactional emails (e.g. registration notifications)</li>
          <li><span className="text-foreground font-medium">Firebase Cloud Messaging (Google)</span> — delivering push notifications to our mobile apps</li>
        </ul>
      </Section>

      <Section title="Data Retention">
        <p>
          We retain your information for as long as your account or your society's account remains active
          on the platform, or as needed to comply with legal obligations. You may request deletion of your
          account and associated personal data by contacting your society admin or us directly (see below).
        </p>
      </Section>

      <Section title="Your Rights">
        <p>
          You can request access to, correction of, or deletion of your personal information at any time
          by contacting your society's admin or us directly using the details below.
        </p>
      </Section>

      <Section title="Children's Privacy">
        <p>
          {APP_NAME} is intended for use by adult residents, security staff, and society administrators.
          We do not knowingly collect information directly from children.
        </p>
      </Section>

      <Section title="Changes to This Policy">
        <p>
          We may update this policy from time to time. Material changes will be reflected by updating the
          "Last updated" date above.
        </p>
      </Section>

      <Section title="Contact Us">
        <p>
          For any questions about this policy or your data, contact us at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">{SUPPORT_EMAIL}</a>.
        </p>
      </Section>
    </main>
  </div>
);

export default PrivacyPolicy;
