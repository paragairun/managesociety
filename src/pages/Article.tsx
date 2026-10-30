import { Link } from "react-router-dom";
import {
  Building2, ArrowLeft, ArrowRight, FileText, AlertTriangle, CheckCircle,
  QrCode, Car, Users, Shield, Package, ScanLine, BarChart3,
  UserCheck, IndianRupee, CalendarDays,
} from "lucide-react";
import { APP_NAME, APP_DOMAIN } from "@/lib/app-url";

const Article = () => (
  <div className="min-h-screen bg-background">
    <header className="border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10">
      <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-lg bg-primary/15 flex items-center justify-center">
            <Building2 className="h-5 w-5 text-primary-ink" />
          </div>
          <span className="font-bold text-foreground text-lg">{APP_NAME}</span>
        </Link>
        <Link to="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to home
        </Link>
      </div>
    </header>

    <main className="max-w-3xl mx-auto px-4 py-12 sm:py-16">

      <div className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-semibold uppercase tracking-widest text-primary-ink">Society Management</span>
          <span className="text-muted-foreground text-xs">·</span>
          <span className="text-xs text-muted-foreground">15 min read</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-foreground leading-tight mb-5">
          From Register to Real-Time: How Modern Housing Societies Run Without Paper
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed">
          Managing a housing society in India has always meant juggling six different problems at once —
          who is at the gate, who has paid maintenance, whether the clubhouse is free on Sunday, where
          the housekeeping staff is, whether that Zomato agent was actually let in, and what the maid's
          attendance looks like this month. For decades, the answer to all of these was some combination
          of a register, a phone call, and a committee member's memory. There is a better way.
        </p>
        <div className="mt-6 h-px bg-border" />
      </div>

      <article className="space-y-12 text-foreground">

        {/* Section 1: The real cost of manual management */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
              <FileText className="h-5 w-5 text-destructive-ink" />
            </div>
            <h2 className="text-xl font-bold">The Real Cost of Running a Society Manually</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Before talking about what is possible, it is worth being honest about what the current system
            costs — not in rupees, but in the time and quiet frustration that everyone has come to accept as normal.
          </p>
          <div className="rounded-xl border border-border bg-destructive/5 p-5 space-y-3">
            {[
              { issue: "The gate register", detail: "Unverifiable handwriting, no entry/exit pairing, no search. A guard writing 400 entries a day spends over 8 hours on nothing but the register." },
              { issue: "Maintenance collection", detail: "Chasing 200 flats for payment by phone, WhatsApp, and door-to-door visits. No single view of who has paid, who hasn't, and what the society owes vendors." },
              { issue: "Amenity bookings", detail: "The clubhouse booking is a WhatsApp message to the secretary. Clashes happen. Nobody knows if the gym is occupied. The committee secretary manages it all personally." },
              { issue: "Staff attendance", detail: "The maid says she came on Monday. The resident says she didn't. There is no record. The housekeeping register at the gate is never checked." },
              { issue: "Delivery chaos", detail: "Every Zomato and Amazon agent triggers a phone call to the resident. At 8 PM. Every day. For 200 flats." },
              { issue: "No audit trail", detail: "Something goes missing. The committee asks for entry records. Someone finds a notebook. That is the best-case scenario." },
            ].map((item) => (
              <div key={item.issue} className="flex gap-3">
                <AlertTriangle className="h-4 w-4 text-destructive-ink shrink-0 mt-0.5" />
                <p className="text-sm"><span className="font-semibold text-foreground">{item.issue}: </span><span className="text-muted-foreground">{item.detail}</span></p>
              </div>
            ))}
          </div>
        </section>

        {/* Section 2: Complete feature overview */}
        <section className="space-y-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Building2 className="h-5 w-5 text-primary-ink" />
            </div>
            <h2 className="text-xl font-bold">Everything {APP_NAME} Handles</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            {APP_NAME} is a complete digital operations platform for housing societies. It covers every
            person, vehicle, payment, and space in your society — from the gate to the accounts to the
            swimming pool booking calendar. Here is a full picture.
          </p>

          {[
            {
              icon: Car,
              title: "Vehicle Management",
              body: "Every registered vehicle gets a unique QR sticker. The guard scans it from any smartphone browser — no app, no login — and the entry is logged in under five seconds with vehicle number, flat, owner name, and timestamp. Residents can register their own vehicles and submit change requests digitally. The admin registers vehicles individually or via bulk CSV upload. A live dashboard shows exactly which vehicles are inside the premises at any moment. Every entry and exit is searchable forever.",
            },
            {
              icon: QrCode,
              title: "Visitor Entry and Guest Passes",
              body: "Residents generate single-use digital guest passes and share them on WhatsApp before their guest even leaves home. The guard scans the pass at the gate — it validates instantly. Each pass is tied to a specific visitor, vehicle, and flat and cannot be reused or forwarded. For unannounced visitors, the guard submits a request from the gate and the resident approves or rejects from their phone. No phone calls to the resident. No judgment calls by the guard. Every visitor entry is logged with a full audit trail.",
            },
            {
              icon: Package,
              title: "Delivery Agent Approvals",
              body: "When a Zomato, Swiggy, Amazon, Blinkit, Zepto, milk, grocery, or courier agent arrives at the gate, the guard takes their photo, enters their mobile number, selects the delivery type, and picks the destination flat. The resident's phone rings with an in-app alert. They tap Approve or Reject. The guard sees the response in real time and acts accordingly. No phone calls. Approved agents appear on the live inside-view. The guard marks their exit when they leave. Entries not responded to within 30 minutes automatically expire.",
            },
            {
              icon: UserCheck,
              title: "Society Staff Tracking",
              body: "Security guards, housekeeping staff, accountants, facility managers, electricians, plumbers, gardeners, and lift operators are registered by the admin. Each gets a printed photo ID card with a QR code generated directly from the platform. The guard scans the card at entry and at exit — the system automatically records the action. Monthly attendance reports show each staff member's first entry, last exit, and hours worked per day, with no manual calculation required.",
            },
            {
              icon: Users,
              title: "House Help Tracking",
              body: "Maids, drivers, cooks, nurses, and personal staff are registered by residents from their own portal. Because one maid often works for multiple households, a single house help can be linked to several flats simultaneously. Each gets a photo ID card with a QR code. Entry and exit are scanned at the gate the same way as society staff. Residents see their own house help's monthly attendance and hours worked. The admin sees attendance across all house helps in the society.",
            },
            {
              icon: IndianRupee,
              title: "Financial Account Management",
              body: "The committee manages maintenance fee collection, expense tracking, and payment history entirely within the platform. Each flat's payment status is visible at a glance — paid, outstanding, or partial. Expenses are logged and categorised so the committee always has a clear picture of what the society has spent and what it is owed. Residents can see their own payment history without calling the secretary. The committee no longer needs to chase payments by phone or maintain a separate spreadsheet.",
            },
            {
              icon: CalendarDays,
              title: "Amenities Booking and Management",
              body: "Residents book society amenities — clubhouse, gym, swimming pool, party hall, guest rooms, and any other shared space — directly from their portal. The booking calendar shows real-time availability, so clashes never happen. Once a booking is confirmed, it appears on the admin's view. Usage is tracked automatically: who booked what, for how long, on which date. The committee no longer needs a secretary to manage bookings manually or a WhatsApp group to check availability.",
            },
            {
              icon: ScanLine,
              title: "Guard Operations Dashboard",
              body: "The guard's interface is built for speed — one button to scan any QR code (vehicle sticker, guest pass, staff ID card, delivery agent), a searchable vehicle lookup for manual verification, a live view of every vehicle and person currently inside, a pending approvals queue for visitor and delivery requests, and a delivery registration form for walk-in agents. The guard never downloads an app, creates an account, or remembers a password. The entire interface runs in any smartphone browser.",
            },
            {
              icon: Shield,
              title: "Resident Self-Service Portal",
              body: "Residents manage their own corner of the society: register vehicles, generate guest passes, approve visitors and deliveries in real time, view complete visit history, manage house helps and track their attendance, view payment history and outstanding dues, book amenities, and manage sub-accounts for family members and tenants. Residents with multiple flats — primary and additional units — manage all of them under one login.",
            },
            {
              icon: BarChart3,
              title: "Admin Control Panel",
              body: "The society admin has a complete command centre: statistics dashboard, bulk vehicle and resident registration via CSV, user and vehicle change request approvals, searchable access logs, full user and vehicle registries, society staff management, attendance reports, visitor entry QR code, boom barrier controls, maintenance fee tracking, expense management, and amenity booking oversight. The admin also defines the society's physical structure — buildings, towers, wings, and flat number ranges — which powers every flat-selection dropdown across the entire platform.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border border-border bg-card p-5 space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon className="h-4 w-4 text-primary-ink" />
                </div>
                <h3 className="font-bold text-foreground">{title}</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
            </div>
          ))}
        </section>

        {/* Section 3: Comparison */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold">Manual vs Digital: The Full Picture</h2>
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/60">
                  <th className="text-left p-3 font-semibold text-foreground">Situation</th>
                  <th className="text-left p-3 font-semibold text-destructive-ink">Manual</th>
                  <th className="text-left p-3 font-semibold text-success-ink">{APP_NAME}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  ["Registered vehicle entry", "Guard writes manually (~90 sec)", "QR scan (~5 sec)"],
                  ["Visitor without prior pass", "Guard calls resident, waits", "Resident approves from phone"],
                  ["Guest coming to visit", "Resident calls guard to expect them", "Resident shares a digital guest pass"],
                  ["Delivery agent at gate", "Guard calls resident, holds agent", "Resident taps Approve in seconds"],
                  ["Maid attendance this month", "No record or manual register", "Auto-calculated with hours worked"],
                  ["Society staff overtime", "No record", "Entry/exit log with daily hours"],
                  ["Maintenance due for flat 302", "Check WhatsApp or call secretary", "Resident sees it in their portal"],
                  ["Booking the clubhouse Sunday", "WhatsApp the secretary, hope for no clash", "Book from portal, calendar shows availability"],
                  ["Who is currently inside", "No one knows", "Live dashboard, always current"],
                  ["Audit trail for incident", "Illegible notebook", "Searchable timestamped log with photos"],
                  ["Onboarding 50 new residents", "Manual forms, weeks of work", "Bulk CSV upload, done in minutes"],
                  ["Guard training required", "Write legibly", "Scan a QR code — that is everything"],
                  ["Hardware needed", "Pen, notebook", "Any smartphone"],
                ].map(([situation, manual, digital]) => (
                  <tr key={situation} className="hover:bg-secondary/20 transition-colors">
                    <td className="p-3 font-medium text-foreground text-xs sm:text-sm">{situation}</td>
                    <td className="p-3 text-muted-foreground text-xs sm:text-sm">{manual}</td>
                    <td className="p-3 text-success-ink font-medium text-xs sm:text-sm">{digital}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 4: Who benefits */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold">Who Gains the Most</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              {
                role: "Residents",
                icon: Shield,
                points: [
                  "No more calls from the guard for every visitor or delivery",
                  "Control who enters for your flat, from your phone",
                  "Know your maid's attendance without asking",
                  "Book amenities without contacting the secretary",
                  "See your maintenance dues and payment history anytime",
                ],
              },
              {
                role: "Guards",
                icon: ScanLine,
                points: [
                  "One scan replaces writing 400 entries a day",
                  "Instant answers on any vehicle or visitor",
                  "No judgment calls — the resident decides entry",
                  "No app, no training, no new device required",
                ],
              },
              {
                role: "Committee",
                icon: BarChart3,
                points: [
                  "Full audit trail for every person and vehicle",
                  "Maintenance collection without chasing residents",
                  "Amenity bookings managed without a secretary",
                  "Staff attendance without manual registers",
                  "Evidence for security incidents, ready in seconds",
                ],
              },
            ].map(({ role, icon: Icon, points }) => (
              <div key={role} className="rounded-xl border border-border bg-card p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Icon className="h-5 w-5 text-primary-ink" />
                  </div>
                  <p className="font-bold text-foreground">{role}</p>
                </div>
                <ul className="space-y-1.5">
                  {points.map((p) => (
                    <li key={p} className="flex gap-2 text-sm text-muted-foreground">
                      <CheckCircle className="h-4 w-4 text-success-ink shrink-0 mt-0.5" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Section 5: Objections */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold">The Objections — And Why They Do Not Hold</h2>
          <div className="space-y-3">
            {[
              {
                q: "Our guard is not tech-savvy.",
                a: "The guard's entire interface is one button: Scan QR. He opens the website on his phone, points the camera, and the entry is logged. No app download, no login, no typing. If your guard can take a WhatsApp photo, he can use this.",
              },
              {
                q: "Our system already works.",
                a: "A paper map also works when you need to drive somewhere. The question is not whether the register functions — it is how much time, safety, and resident goodwill the manual approach costs your society every single day.",
              },
              {
                q: "The setup will take months.",
                a: "Register your society, configure your towers and wings, and print the gate QR code. You are live in under 10 minutes. Residents and vehicles can be uploaded in bulk from a spreadsheet. No hardware to install, no vendor to call.",
              },
              {
                q: "We only have a few hundred flats — is this overkill?",
                a: "The platform is free to start and scales from a 50-flat independent building to a 2,000-flat township. The features you do not need simply do not get in the way of the ones you do.",
              },
            ].map(({ q, a }) => (
              <div key={q} className="rounded-xl border border-border p-5 space-y-2">
                <p className="font-semibold text-foreground">"{q}"</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Closing */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold">The Bigger Picture</h2>
          <p className="text-muted-foreground leading-relaxed">
            Every feature in {APP_NAME} was built from a real friction point that a real housing society
            faces every day. The platform started at the gate because that is the most visible problem.
            It grew to cover deliveries, staff attendance, house help tracking, maintenance collection,
            and amenity bookings — because each of these is its own daily source of wasted time, missed
            information, and avoidable frustration.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            The goal is not to digitise the register. It is to make the register — and the maintenance
            spreadsheet, and the booking WhatsApp group, and the attendance notebook — unnecessary.
            And to give residents, guards, and committee members back the hours and peace of mind that
            the old system was quietly taking from them every single day.
          </p>
        </section>

        {/* CTA */}
        <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6 sm:p-8 space-y-4">
          <h2 className="text-xl font-bold text-foreground">Get Your Society on {APP_NAME}</h2>
          <p className="text-muted-foreground leading-relaxed">
            Free to use. No hardware. No app to install. Your society gets its own dedicated URL —
            <span className="font-mono text-foreground text-sm"> {APP_DOMAIN}/your-society-name</span> —
            and a complete platform for everything that happens in your society, every day.
            Live in under 10 minutes.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Link
              to="/register-society"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground font-semibold px-6 py-3 text-sm hover:bg-primary/90 transition-colors"
            >
              Register Your Society — It's Free <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/login"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card text-foreground font-medium px-6 py-3 text-sm hover:bg-secondary/40 transition-colors"
            >
              Already registered? Sign in
            </Link>
          </div>
        </div>

      </article>

      <div className="mt-16 pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} {APP_NAME} · {APP_DOMAIN}</p>
        <div className="flex gap-4 text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground transition-colors">Home</Link>
          <Link to="/register-society" className="hover:text-foreground transition-colors">Register Society</Link>
          <Link to="/login" className="hover:text-foreground transition-colors">Sign In</Link>
        </div>
      </div>
    </main>
  </div>
);

export default Article;
