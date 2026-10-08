import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Shield, ScanLine, ClipboardList, Building2, QrCode, Users, ArrowRight,
  Car, Package, Wallet, Sparkles, IdCard, FileText, Activity, Radio,
  CheckCircle2, CalendarCheck, Plus, RefreshCw, Clock, X, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/ThemeToggle";

const DISPLAY_FONT = "'Philosopher', serif";
const LABEL_FONT = "'Montserrat', sans-serif";

const FEATURES = [
  {
    icon: Car,
    title: "Vehicle & Visitor Management",
    description: "QR stickers for every vehicle, single-use guest passes, and instant gate verification — no logbooks.",
    tint: "bg-primary/10 text-primary",
  },
  {
    icon: IdCard,
    title: "Staff & House Help Tracking",
    description: "ID cards with QR check-in for domestic staff and society employees, with a full attendance log.",
    tint: "bg-accent/10 text-accent",
  },
  {
    icon: Package,
    title: "Delivery Management",
    description: "Delivery agents check in at the gate; residents approve or reject before anyone's let up.",
    tint: "bg-success/10 text-success",
  },
  {
    icon: Wallet,
    title: "Maintenance Billing",
    description: "Area-based dues, configurable charge heads, and full payment tracking for every flat.",
    tint: "bg-warning/10 text-warning",
    graphic: "dues",
  },
  {
    icon: Users,
    title: "Role-Based Dashboards",
    description: "Admins, guards, and residents each get their own scoped portal — nobody sees more than they need.",
    tint: "bg-primary/10 text-primary",
  },
  {
    icon: Sparkles,
    title: "Amenities",
    description: "Clubhouse, gym, and pool booking with approvals and usage limits.",
    tint: "bg-muted text-muted-foreground",
    soon: true,
  },
];

const STATS = [
  { value: "6", label: "Built-in modules" },
  { value: "3", label: "Role-based portals" },
  { value: "100%", label: "Digital record-keeping" },
  { value: "0", label: "Paper logbooks" },
];

/** Small illustrative ring graphic for the maintenance billing card -- not tied to live data. */
const DuesRing = () => (
  <svg width="56" height="56" viewBox="0 0 56 56" className="shrink-0" role="img" aria-label="Illustrative collection-rate ring, 68 percent">
    <circle cx="28" cy="28" r="24" fill="none" stroke="hsl(var(--muted))" strokeWidth="6" />
    <circle
      cx="28" cy="28" r="24" fill="none" stroke="hsl(var(--warning))" strokeWidth="6"
      strokeDasharray={`${2 * Math.PI * 24 * 0.68} ${2 * Math.PI * 24}`}
      strokeLinecap="round" transform="rotate(-90 28 28)"
    />
    <text x="28" y="32" textAnchor="middle" fontSize="13" fontWeight="600" fill="hsl(var(--foreground))">68%</text>
  </svg>
);

// ─── Phone demo: one phone frame, auto-cycling through real screens ────────

interface Slide { roleLabel: string; screenLabel: string; roleTint: string; content: React.ReactNode; }

const SLIDES: Slide[] = [
  // ── Admin ──────────────────────────────────────────────────────────────
  {
    roleLabel: "Admin", screenLabel: "Home", roleTint: "bg-warning/15 text-warning",
    content: (
      <div className="space-y-2.5">
        <div>
          <p className="text-sm font-semibold text-foreground">Shree Laxmi CHSL</p>
          <p className="text-xs text-muted-foreground">Wednesday, 5 August</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border-l-4 border-l-success bg-secondary/40 p-2">
            <p className="text-[8px] text-muted-foreground flex items-center gap-1"><Activity className="h-2.5 w-2.5" /> Currently inside</p>
            <p className="text-base font-bold text-foreground">14</p>
          </div>
          <div className="rounded-lg border-l-4 border-l-warning bg-secondary/40 p-2">
            <p className="text-[8px] text-muted-foreground">Dues outstanding</p>
            <p className="text-base font-bold text-foreground">₹1.8L</p>
          </div>
        </div>
        <div>
          <p className="text-[8px] text-muted-foreground mb-1" style={{ fontFamily: LABEL_FONT }}>QUICK ACTIONS</p>
          <div className="grid grid-cols-4 gap-1.5">
            {[
              { icon: Plus, label: "Register Vehicle", tint: "bg-primary/10 text-primary" },
              { icon: Car, label: "Vehicle Registry", tint: "bg-accent/10 text-accent" },
              { icon: Users, label: "User Registry", tint: "bg-warning/10 text-warning" },
              { icon: RefreshCw, label: "Vehicle Requests", tint: "bg-primary/10 text-primary" },
              { icon: IdCard, label: "Staff", tint: "bg-success/10 text-success" },
              { icon: Radio, label: "Boom Barriers", tint: "bg-accent/10 text-accent" },
              { icon: Wallet, label: "Billing", tint: "bg-warning/10 text-warning" },
              { icon: Sparkles, label: "Amenities", tint: "bg-muted text-muted-foreground", soon: true },
            ].map((t, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <span className={`h-7 w-7 rounded-full flex items-center justify-center relative ${t.tint}`}>
                  <t.icon className="h-3.5 w-3.5" />
                  {t.soon && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-muted border border-border" />}
                </span>
                <span className="text-[6px] leading-none text-center text-muted-foreground">{t.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[8px] text-muted-foreground" style={{ fontFamily: LABEL_FONT }}>RECENT ACTIVITY</p>
            <span className="h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-[8px] font-bold flex items-center justify-center">5</span>
          </div>
          {[
            { icon: "→", text: "MH-47-BK-1836 entered", tint: "bg-success/10 text-success" },
            { icon: "←", text: "Guest — Anil exited", tint: "bg-muted text-muted-foreground" },
          ].map((a, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className={`h-4 w-4 rounded-full flex items-center justify-center text-[8px] shrink-0 ${a.tint}`}>{a.icon}</span>
              <p className="text-[8px] text-foreground truncate">{a.text}</p>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    roleLabel: "Admin", screenLabel: "User Registry", roleTint: "bg-warning/15 text-warning",
    content: (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground mb-1">User Registry</p>
        {[
          { name: "Rahul", role: "resident", flat: "A-101" },
          { name: "Mahaveer", role: "guard", flat: null },
          { name: "Priya Shah", role: "resident", flat: "B-204" },
        ].map((u, i) => (
          <div key={i} className="rounded-lg border border-border p-2 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-foreground">{u.name}</p>
              {u.flat && <p className="text-[9px] text-muted-foreground">{u.flat}</p>}
            </div>
            <span className={`text-[9px] font-medium px-2 py-0.5 rounded-full ${u.role === "guard" ? "bg-primary/15 text-primary" : "bg-success/15 text-success"}`}>{u.role}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    roleLabel: "Admin", screenLabel: "Maintenance Billing", roleTint: "bg-warning/15 text-warning",
    content: (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground mb-1">Maintenance Billing</p>
        <div className="rounded-lg border border-border p-3 flex items-center gap-3">
          <DuesRing />
          <div>
            <p className="text-[10px] text-muted-foreground">Collected this month</p>
            <p className="text-sm font-bold text-foreground">₹4.2L / ₹6.2L</p>
          </div>
        </div>
        {[["A-101", "₹2,450", true], ["B-204", "₹2,450", false]].map(([flat, amt, paid], i) => (
          <div key={i} className="rounded-lg border border-border p-2 flex items-center justify-between text-xs">
            <span className="text-foreground">{flat}</span>
            <span className="text-muted-foreground">{amt}</span>
            <span className={paid ? "text-success" : "text-warning"}>{paid ? "Paid" : "Due"}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    roleLabel: "Admin", screenLabel: "Register Vehicle", roleTint: "bg-warning/15 text-warning",
    content: (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground mb-1 flex items-center gap-1"><Plus className="h-3.5 w-3.5" /> Register Vehicle</p>
        <div className="rounded-lg border border-border p-3 space-y-2">
          <div>
            <p className="text-[9px] text-muted-foreground">Vehicle Number</p>
            <p className="text-xs font-medium text-foreground">MH-47-BK-1836</p>
          </div>
          <div>
            <p className="text-[9px] text-muted-foreground">Owner</p>
            <p className="text-xs font-medium text-foreground">Rahul · A-101</p>
          </div>
          <span className="inline-block text-[9px] font-medium px-2 py-1 rounded-full bg-primary/15 text-primary">Car</span>
        </div>
      </div>
    ),
  },
  {
    roleLabel: "Admin", screenLabel: "Vehicle Registry", roleTint: "bg-warning/15 text-warning",
    content: (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground mb-1">Vehicle Registry</p>
        {[
          { num: "MH-47-BK-1836", flat: "A-101", type: "Car" },
          { num: "MH-47-BD-7714", flat: "A-101", type: "Bike" },
          { num: "MH-02-XR-2201", flat: "B-204", type: "Car" },
        ].map((v, i) => (
          <div key={i} className="rounded-lg border border-border p-2 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-foreground">{v.num}</p>
              <p className="text-[9px] text-muted-foreground">{v.flat}</p>
            </div>
            <span className="text-[9px] text-muted-foreground">{v.type}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    roleLabel: "Admin", screenLabel: "Vehicle Requests", roleTint: "bg-warning/15 text-warning",
    content: (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground mb-1 flex items-center gap-1"><RefreshCw className="h-3.5 w-3.5" /> Vehicle Requests</p>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-foreground">Add: MH-14-CD-9081</p>
          <p className="text-[9px] text-muted-foreground mt-0.5">Requested by Priya · B-204</p>
          <div className="flex gap-2 mt-2">
            <span className="flex items-center gap-1 text-[9px] font-medium px-2 py-1 rounded-full bg-success/15 text-success"><Check className="h-2.5 w-2.5" /> Approve</span>
            <span className="flex items-center gap-1 text-[9px] font-medium px-2 py-1 rounded-full bg-destructive/15 text-destructive"><X className="h-2.5 w-2.5" /> Reject</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    roleLabel: "Admin", screenLabel: "Boom Barriers", roleTint: "bg-warning/15 text-warning",
    content: (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground mb-1 flex items-center gap-1"><Radio className="h-3.5 w-3.5" /> Boom Barriers</p>
        {[["Main Gate", true], ["Service Gate", false]].map(([name, online], i) => (
          <div key={i} className="rounded-lg border border-border p-2 flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">{name as string}</span>
            <span className={`text-[9px] font-medium px-2 py-0.5 rounded-full ${online ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
              {online ? "Online" : "Offline"}
            </span>
          </div>
        ))}
      </div>
    ),
  },
  {
    roleLabel: "Admin", screenLabel: "Amenities Setup", roleTint: "bg-warning/15 text-warning",
    content: (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground mb-1 flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" /> Amenities Setup</p>
        {[["Clubhouse", "Needs approval"], ["Gym", "Auto-confirm"]].map(([name, mode], i) => (
          <div key={i} className="rounded-lg border border-border p-2 flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">{name}</span>
            <span className="text-[9px] text-muted-foreground">{mode}</span>
          </div>
        ))}
      </div>
    ),
  },
  // ── Guard ──────────────────────────────────────────────────────────────
  {
    roleLabel: "Mahaveer", screenLabel: "Home", roleTint: "bg-primary/15 text-primary",
    content: (
      <div className="space-y-2">
        <div>
          <p className="text-sm font-semibold text-foreground">Shree Laxmi CHSL</p>
          <p className="text-xs text-muted-foreground">Wednesday, 5 August</p>
        </div>
        <div className="rounded-lg bg-primary/10 border border-primary/30 p-2 flex items-center justify-between">
          <p className="text-[10px] font-semibold text-foreground">Tap to start scanning</p>
          <span className="h-6 px-2 rounded-md bg-primary text-primary-foreground flex items-center gap-1 text-[9px] font-bold">
            <ScanLine className="h-2.5 w-2.5" /> Scan QR
          </span>
        </div>
        <div className="rounded-lg bg-success/10 border border-success/30 p-2 flex items-center justify-between">
          <p className="text-[10px] font-semibold text-foreground">Register a delivery</p>
          <span className="h-6 px-2 rounded-md border border-success/50 text-success flex items-center gap-1 text-[9px] font-bold">
            <Package className="h-2.5 w-2.5" /> Register
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border-l-4 border-l-warning bg-secondary/40 p-1.5">
            <p className="text-[8px] text-muted-foreground">Pending approvals</p>
            <p className="text-sm font-bold text-foreground">3</p>
          </div>
          <div className="rounded-lg border-l-4 border-l-success bg-secondary/40 p-1.5">
            <p className="text-[8px] text-muted-foreground">Currently inside</p>
            <p className="text-sm font-bold text-foreground">14</p>
          </div>
        </div>
        <div>
          <p className="text-[8px] text-muted-foreground mb-1" style={{ fontFamily: LABEL_FONT }}>QUICK ACTIONS</p>
          <div className="grid grid-cols-4 gap-1.5">
            {[
              { icon: ScanLine, label: "Search & Scan", tint: "bg-primary/10 text-primary" },
              { icon: Clock, label: "Pending Approvals", tint: "bg-warning/10 text-warning" },
              { icon: Car, label: "Live Inside", tint: "bg-success/10 text-success" },
              { icon: Radio, label: "Boom Barriers", tint: "bg-accent/10 text-accent" },
              { icon: Package, label: "Deliveries", tint: "bg-success/10 text-success" },
              { icon: Sparkles, label: "Amenities", tint: "bg-muted text-muted-foreground", soon: true },
            ].map((t, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <span className={`h-7 w-7 rounded-full flex items-center justify-center relative ${t.tint}`}>
                  <t.icon className="h-3.5 w-3.5" />
                  {t.soon && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-muted border border-border" />}
                </span>
                <span className="text-[6px] leading-none text-center text-muted-foreground">{t.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border p-2 space-y-1.5">
          <p className="text-[8px] text-muted-foreground" style={{ fontFamily: LABEL_FONT }}>RECENT ACTIVITY</p>
          {[
            { icon: "→", text: "MH-47-BK-1836 entered", tint: "bg-success/10 text-success" },
            { icon: "←", text: "Swiggy Delivery exited", tint: "bg-muted text-muted-foreground" },
          ].map((a, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className={`h-4 w-4 rounded-full flex items-center justify-center text-[8px] shrink-0 ${a.tint}`}>{a.icon}</span>
              <p className="text-[8px] text-foreground truncate">{a.text}</p>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    roleLabel: "Mahaveer", screenLabel: "Scan Result", roleTint: "bg-primary/15 text-primary",
    content: (
      <div className="space-y-3 flex flex-col items-center text-center pt-6">
        <span className="h-14 w-14 rounded-full bg-success/15 text-success flex items-center justify-center">
          <CheckCircle2 className="h-8 w-8" />
        </span>
        <div>
          <p className="text-sm font-bold text-foreground">Entry Approved</p>
          <p className="text-xs text-muted-foreground mt-1">MH-47-BK-1836 · Rahul (A-101)</p>
        </div>
        <div className="w-full rounded-lg border border-border p-2 text-[10px] text-muted-foreground">
          Logged at 5:42 PM
        </div>
      </div>
    ),
  },
  {
    roleLabel: "Mahaveer", screenLabel: "Live Inside", roleTint: "bg-primary/15 text-primary",
    content: (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground mb-1">Currently Inside (14)</p>
        {[
          { name: "MH-47-BK-1836", flat: "A-101", type: "Resident" },
          { name: "Swiggy Delivery", flat: "B-204", type: "Delivery" },
          { name: "Guest — Anil", flat: "A-101", type: "Guest" },
        ].map((v, i) => (
          <div key={i} className="rounded-lg border border-border p-2 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-foreground">{v.name}</p>
              <p className="text-[9px] text-muted-foreground">{v.flat}</p>
            </div>
            <span className="text-[9px] text-success">{v.type}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    roleLabel: "Mahaveer", screenLabel: "Pending Approvals", roleTint: "bg-primary/15 text-primary",
    content: (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground mb-1 flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Pending Approvals</p>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-foreground">Guest — Anil</p>
          <p className="text-[9px] text-muted-foreground mt-0.5">Waiting on Rahul, A-101</p>
          <span className="inline-block mt-2 text-[9px] font-medium px-2 py-1 rounded-full bg-warning/15 text-warning">Awaiting response</span>
        </div>
      </div>
    ),
  },
  {
    roleLabel: "Mahaveer", screenLabel: "Register Delivery", roleTint: "bg-primary/15 text-primary",
    content: (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground mb-1 flex items-center gap-1"><Package className="h-3.5 w-3.5" /> Register Delivery</p>
        <div className="rounded-lg border border-border p-3 space-y-2">
          <div>
            <p className="text-[9px] text-muted-foreground">Delivery for</p>
            <p className="text-xs font-medium text-foreground">A-101 · Rahul</p>
          </div>
          <div>
            <p className="text-[9px] text-muted-foreground">Agent</p>
            <p className="text-xs font-medium text-foreground">Amazon Delivery</p>
          </div>
          <span className="inline-block text-[9px] font-medium px-2 py-1 rounded-full bg-warning/15 text-warning">Notifying resident…</span>
        </div>
      </div>
    ),
  },
  {
    roleLabel: "Mahaveer", screenLabel: "Boom Barriers", roleTint: "bg-primary/15 text-primary",
    content: (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground mb-1 flex items-center gap-1"><Radio className="h-3.5 w-3.5" /> Boom Barriers</p>
        <div className="rounded-lg border border-border p-3 flex items-center justify-between">
          <span className="text-xs font-medium text-foreground">Main Gate</span>
          <span className="h-7 px-3 rounded-md bg-primary text-primary-foreground flex items-center text-[10px] font-bold">Open</span>
        </div>
      </div>
    ),
  },
  // ── Resident ───────────────────────────────────────────────────────────
  {
    roleLabel: "Rahul", screenLabel: "Home", roleTint: "bg-success/15 text-success",
    content: (
      <div className="space-y-2.5">
        <div>
          <p className="text-sm font-semibold text-foreground">Good morning, Rahul</p>
          <p className="text-xs text-muted-foreground">Shree Laxmi CHSL · A-101</p>
        </div>
        <div className="rounded-lg border-l-4 border-l-primary bg-secondary/40 p-3 flex items-center justify-between">
          <div>
            <p className="text-[10px] text-muted-foreground">Outstanding dues</p>
            <p className="text-lg font-bold text-foreground">₹2,450</p>
          </div>
          <ArrowRight className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-[8px] text-muted-foreground mb-1" style={{ fontFamily: LABEL_FONT }}>QUICK ACTIONS</p>
          <div className="grid grid-cols-4 gap-1.5">
            {[
              { icon: QrCode, label: "Guest Pass", tint: "bg-primary/10 text-primary" },
              { icon: Car, label: "Vehicles", tint: "bg-accent/10 text-accent" },
              { icon: Wallet, label: "Dues", tint: "bg-warning/10 text-warning" },
              { icon: Package, label: "Deliveries", tint: "bg-success/10 text-success" },
              { icon: Users, label: "House Helps", tint: "bg-accent/10 text-accent" },
              { icon: ClipboardList, label: "History", tint: "bg-primary/10 text-primary" },
              { icon: Sparkles, label: "Amenities", tint: "bg-muted text-muted-foreground", soon: true },
            ].map((t, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <span className={`h-7 w-7 rounded-full flex items-center justify-center relative ${t.tint}`}>
                  <t.icon className="h-3.5 w-3.5" />
                  {t.soon && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-muted border border-border" />}
                </span>
                <span className="text-[6px] leading-none text-center text-muted-foreground">{t.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border p-2 space-y-1.5">
          <p className="text-[8px] text-muted-foreground" style={{ fontFamily: LABEL_FONT }}>RECENT ACTIVITY</p>
          {[
            { icon: "→", text: "Guest — Anil entered", tint: "bg-success/10 text-success" },
            { icon: "←", text: "Swiggy Delivery exited", tint: "bg-muted text-muted-foreground" },
          ].map((a, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className={`h-4 w-4 rounded-full flex items-center justify-center text-[8px] shrink-0 ${a.tint}`}>{a.icon}</span>
              <p className="text-[8px] text-foreground truncate">{a.text}</p>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    roleLabel: "Rahul", screenLabel: "Guest Pass", roleTint: "bg-success/15 text-success",
    content: (
      <div className="space-y-3 flex flex-col items-center text-center pt-2">
        <p className="text-sm font-semibold text-foreground self-start">Guest Pass</p>
        <div className="h-24 w-24 rounded-lg bg-foreground/90 flex items-center justify-center">
          <QrCode className="h-14 w-14 text-background" />
        </div>
        <div>
          <p className="text-xs font-medium text-foreground">Anil Kumar</p>
          <p className="text-[10px] text-muted-foreground">Valid for one entry today</p>
        </div>
      </div>
    ),
  },
  {
    roleLabel: "Rahul", screenLabel: "My Dues", roleTint: "bg-success/15 text-success",
    content: (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground mb-1">My Dues</p>
        <div className="rounded-lg border border-border p-3 space-y-1.5">
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Maintenance</span><span className="text-foreground">₹2,000</span></div>
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Sinking Fund</span><span className="text-foreground">₹450</span></div>
          <div className="flex justify-between text-xs font-semibold pt-1 border-t border-border"><span>Total</span><span>₹2,450</span></div>
        </div>
        <span className="inline-block text-[9px] font-medium px-2 py-1 rounded-full bg-warning/15 text-warning">Due 10 August</span>
      </div>
    ),
  },
  {
    roleLabel: "Rahul", screenLabel: "Amenities", roleTint: "bg-success/15 text-success",
    content: (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground mb-1 flex items-center gap-1"><CalendarCheck className="h-3.5 w-3.5" /> Book an Amenity</p>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-foreground">Clubhouse</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Sat, 8 Aug · 6:00 – 8:00 PM</p>
          <span className="inline-block mt-2 text-[9px] font-medium px-2 py-1 rounded-full bg-success/15 text-success">Confirmed</span>
        </div>
      </div>
    ),
  },
  {
    roleLabel: "Rahul", screenLabel: "My Vehicles", roleTint: "bg-success/15 text-success",
    content: (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground mb-1 flex items-center gap-1"><Car className="h-3.5 w-3.5" /> My Vehicles</p>
        {[["MH-47-BK-1836", "Car"], ["MH-47-BD-7714", "Bike"]].map(([num, type], i) => (
          <div key={i} className="rounded-lg border border-border p-2 flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">{num}</span>
            <span className="text-[9px] text-muted-foreground">{type}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    roleLabel: "Rahul", screenLabel: "Deliveries", roleTint: "bg-success/15 text-success",
    content: (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground mb-1 flex items-center gap-1"><Package className="h-3.5 w-3.5" /> Deliveries</p>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-foreground">Amazon Delivery</p>
          <p className="text-[9px] text-muted-foreground mt-0.5">Waiting at the gate</p>
          <div className="flex gap-2 mt-2">
            <span className="flex items-center gap-1 text-[9px] font-medium px-2 py-1 rounded-full bg-success/15 text-success"><Check className="h-2.5 w-2.5" /> Approve</span>
            <span className="flex items-center gap-1 text-[9px] font-medium px-2 py-1 rounded-full bg-destructive/15 text-destructive"><X className="h-2.5 w-2.5" /> Reject</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    roleLabel: "Rahul", screenLabel: "Visit History", roleTint: "bg-success/15 text-success",
    content: (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground mb-1 flex items-center gap-1"><ClipboardList className="h-3.5 w-3.5" /> Visit History</p>
        {[
          { name: "Anil (Guest)", time: "Today, 5:42 PM" },
          { name: "Swiggy Delivery", time: "Today, 1:15 PM" },
        ].map((v, i) => (
          <div key={i} className="rounded-lg border border-border p-2">
            <p className="text-xs font-medium text-foreground">{v.name}</p>
            <p className="text-[9px] text-muted-foreground">{v.time}</p>
          </div>
        ))}
      </div>
    ),
  },
  {
    roleLabel: "Rahul", screenLabel: "House Helps", roleTint: "bg-success/15 text-success",
    content: (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground mb-1 flex items-center gap-1"><Users className="h-3.5 w-3.5" /> House Helps</p>
        {[["Sunita (Maid)", "Checked in"], ["Ramesh (Driver)", "Not inside"]].map(([name, status], i) => (
          <div key={i} className="rounded-lg border border-border p-2 flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">{name}</span>
            <span className="text-[9px] text-muted-foreground">{status}</span>
          </div>
        ))}
      </div>
    ),
  },
];

const SLIDE_DURATION_MS = 3200;

const PhoneDemo = () => {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), SLIDE_DURATION_MS);
    return () => clearInterval(timer);
  }, []);

  const slide = SLIDES[index];

  return (
    <div className="flex flex-col items-center gap-4 mx-auto">
      {/* Phone bezel */}
      <div className="relative w-[280px] h-[560px] rounded-[2.5rem] border-[10px] border-foreground/90 bg-foreground/90 shadow-2xl">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-5 bg-foreground/90 rounded-b-xl z-10" />
        <div className="relative h-full w-full rounded-[1.75rem] overflow-hidden bg-background">
          {/* Status bar */}
          <div className="h-8 flex items-center justify-between px-5 text-[10px] font-medium text-foreground" style={{ fontFamily: LABEL_FONT }}>
            <span>9:41</span>
            <span>●●●</span>
          </div>
          {/* Progress segments */}
          <div className="flex gap-1 px-3 pb-2">
            {SLIDES.map((_, i) => (
              <div key={i} className="h-0.5 flex-1 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: i < index ? "100%" : i === index ? "100%" : "0%", transitionDuration: i === index ? `${SLIDE_DURATION_MS}ms` : "0ms" }}
                />
              </div>
            ))}
          </div>
          {/* Screen content */}
          <div key={index} className="px-4 pb-4 animate-in fade-in duration-300">
            {slide.content}
          </div>
        </div>
      </div>
      {/* Role / screen label */}
      <div className="flex items-center gap-2 text-sm">
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${slide.roleTint}`}>{slide.roleLabel}</span>
        <span className="text-muted-foreground">{slide.screenLabel}</span>
      </div>
    </div>
  );
};

const Index = () => (
  <div className="min-h-screen bg-background">
    {/* Top bar */}
    <header className="border-b border-border">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-lg bg-primary/15 flex items-center justify-center">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <span className="font-bold text-foreground text-lg" style={{ fontFamily: DISPLAY_FONT }}>ManageSociety</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="outline" size="sm">
            <Link to="/login">Login</Link>
          </Button>
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link to="/register-society">Register Society</Link>
          </Button>
        </div>
      </div>
    </header>

    {/* Hero */}
    <section className="relative overflow-hidden border-b border-border">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent pointer-events-none" />
      <div className="relative max-w-6xl mx-auto px-4 py-16 sm:py-20 grid lg:grid-cols-2 gap-12 items-center">
        <div className="text-center lg:text-left">
          <p className="text-xs font-semibold tracking-widest text-primary uppercase mb-3" style={{ fontFamily: LABEL_FONT }}>
            Complete Society Management
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-5" style={{ fontFamily: DISPLAY_FONT }}>
            Everything your society runs on. One platform.
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto lg:mx-0 mb-8">
            Vehicles, visitors, staff, deliveries, and maintenance dues — replace scattered logbooks and
            spreadsheets with one QR-powered platform built for Indian housing societies.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
            <Button asChild size="lg" className="text-base font-bold gap-2">
              <Link to="/register-society">Register Your Society <ArrowRight className="h-4 w-4" /></Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="text-base">
              <Link to="/login">I already have an account</Link>
            </Button>
          </div>
        </div>
        <PhoneDemo />
      </div>
    </section>

    {/* Stats band */}
    <section className="border-b border-border bg-secondary/30">
      <div className="max-w-5xl mx-auto px-4 py-10 grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
        {STATS.map((s) => (
          <div key={s.label}>
            <p className="text-3xl sm:text-4xl font-bold text-foreground" style={{ fontFamily: DISPLAY_FONT }}>{s.value}</p>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mt-1" style={{ fontFamily: LABEL_FONT }}>{s.label}</p>
          </div>
        ))}
      </div>
    </section>

    {/* Features */}
    <section className="max-w-6xl mx-auto px-4 py-16">
      <h2 className="text-3xl font-bold text-foreground text-center mb-3" style={{ fontFamily: DISPLAY_FONT }}>
        Everything your society needs
      </h2>
      <p className="text-muted-foreground text-center max-w-xl mx-auto mb-12">
        Each society gets its own isolated portal — separate residents, guards, admins, and data.
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {FEATURES.map((f) => (
          <div key={f.title} className={`relative rounded-xl border p-6 ${f.soon ? "border-dashed border-border bg-muted/20" : "border-border bg-card"}`}>
            {f.soon && (
              <span className="absolute top-4 right-4 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border" style={{ fontFamily: LABEL_FONT }}>
                COMING SOON
              </span>
            )}
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className={`h-12 w-12 rounded-lg flex items-center justify-center ${f.tint}`}>
                <f.icon className="h-6 w-6" />
              </div>
              {f.graphic === "dues" && <DuesRing />}
            </div>
            <h3 className="font-semibold text-foreground mb-2">{f.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
          </div>
        ))}
      </div>
    </section>

    {/* How it works */}
    <section className="border-t border-border bg-secondary/30">
      <div className="max-w-5xl mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-foreground text-center mb-12" style={{ fontFamily: DISPLAY_FONT }}>
          How it works
        </h2>
        <div className="grid sm:grid-cols-3 gap-6">
          {[
            { n: 1, t: "Register your society", d: "Submit your society details — name, address, and admin contact." },
            { n: 2, t: "Get approved", d: "Our platform team reviews and activates your society within hours." },
            { n: 3, t: "Onboard everyone", d: "Add guards, invite residents, register vehicles and staff, and set up dues." },
          ].map((s) => (
            <div key={s.n} className="text-center">
              <div className="mx-auto h-12 w-12 rounded-full bg-primary text-primary-foreground font-bold flex items-center justify-center mb-3">
                {s.n}
              </div>
              <h3 className="font-semibold text-foreground mb-2">{s.t}</h3>
              <p className="text-sm text-muted-foreground">{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* Role portals */}
    <section className="max-w-5xl mx-auto px-4 py-16">
      <h2 className="text-3xl font-bold text-foreground text-center mb-12" style={{ fontFamily: DISPLAY_FONT }}>
        Choose your portal
      </h2>
      <div className="grid sm:grid-cols-3 gap-4">
        <Link to="/login/society?role=admin" className="group">
          <Card className="h-full transition-all hover:border-warning/50 hover:shadow-lg hover:-translate-y-1">
            <CardContent className="p-6 text-center">
              <div className="mx-auto h-14 w-14 rounded-xl bg-warning/15 text-warning flex items-center justify-center mb-4">
                <Shield className="h-7 w-7" />
              </div>
              <p className="font-bold text-foreground text-lg mb-2">Admin / Committee</p>
              <p className="text-sm text-muted-foreground">Manage residents, vehicles, staff, and maintenance billing.</p>
            </CardContent>
          </Card>
        </Link>
        <Link to="/login/society?role=guard" className="group">
          <Card className="h-full transition-all hover:border-primary/50 hover:shadow-lg hover:-translate-y-1">
            <CardContent className="p-6 text-center">
              <div className="mx-auto h-14 w-14 rounded-xl bg-primary/15 text-primary flex items-center justify-center mb-4">
                <ScanLine className="h-7 w-7" />
              </div>
              <p className="font-bold text-foreground text-lg mb-2">Security Guard</p>
              <p className="text-sm text-muted-foreground">Scan QRs for vehicles, guests, staff, and deliveries.</p>
            </CardContent>
          </Card>
        </Link>
        <Link to="/login/society?role=resident" className="group">
          <Card className="h-full transition-all hover:border-success/50 hover:shadow-lg hover:-translate-y-1">
            <CardContent className="p-6 text-center">
              <div className="mx-auto h-14 w-14 rounded-xl bg-success/15 text-success flex items-center justify-center mb-4">
                <ClipboardList className="h-7 w-7" />
              </div>
              <p className="font-bold text-foreground text-lg mb-2">Residents</p>
              <p className="text-sm text-muted-foreground">Guest passes, dues, deliveries, and visit history — all in one place.</p>
            </CardContent>
          </Card>
        </Link>
      </div>
      <div className="text-center mt-10">
        <Link to="/super-admin" className="text-xs text-muted-foreground hover:text-foreground">
          Platform admin →
        </Link>
      </div>
    </section>

    <section className="max-w-5xl mx-auto px-4 py-16">
      <h2 className="text-2xl font-bold text-foreground mb-2">From the desk of ManageSociety</h2>
      <p className="text-muted-foreground mb-8">Practical insights on society management and security.</p>
      <Link to="/article/digital-vs-paper-society-management" className="group block rounded-2xl border border-border bg-card hover:border-primary/40 transition-colors p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
            <FileText className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-2">Society Management</p>
            <h3 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors leading-snug mb-2">
              Why Your Housing Society Needs to Move Beyond the Paper Register
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              What the paper register is actually costing your society in time, safety, and resident frustration —
              and why going digital is simpler than you think.
            </p>
            <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
              Read article <ArrowRight className="h-3 w-3" />
            </p>
          </div>
        </div>
      </Link>
    </section>

    <footer className="border-t border-border py-8 text-center">
      <p className="text-xs text-muted-foreground">
        © {new Date().getFullYear()} ManageSociety — made with love by parag.airun@gmail.com
      </p>
    </footer>
  </div>
);

export default Index;
