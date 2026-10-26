import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import { Download, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_NAME, APP_DOMAIN } from "@/lib/app-url";

interface StaffIdCardProps {
  qrCode: string;
  name: string;
  role: string;
  category: "society_staff" | "house_help";
  photoBase64?: string | null;
  societyName?: string | null;
  flats?: string[];
  fileBaseName?: string;
}

const GOLD = "#C9A227";
const DARK = "#0F121C";
const CARD_W = 480;
const CARD_H = 300;
const QR_SIZE = 140;

const StaffIdCard = ({ qrCode, name, role, category, photoBase64, societyName, flats, fileBaseName }: StaffIdCardProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const render = async () => {
      const canvas = canvasRef.current!;
      canvas.width = CARD_W;
      canvas.height = CARD_H;
      const ctx = canvas.getContext("2d")!;

      // Background
      ctx.fillStyle = GOLD;
      ctx.fillRect(0, 0, CARD_W, CARD_H);

      // Dark right panel for QR
      const qrPanelX = CARD_W - QR_SIZE - 32;
      ctx.fillStyle = DARK;
      ctx.fillRect(qrPanelX - 12, 0, CARD_W - qrPanelX + 12, CARD_H);

      // Society name
      ctx.fillStyle = DARK;
      ctx.font = `700 13px "Philosopher", serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText((societyName ?? APP_NAME).toUpperCase(), 20, 16);

      // Category badge
      const badge = category === "society_staff" ? "SOCIETY STAFF" : "HOUSE HELP";
      ctx.font = `600 10px "Montserrat", sans-serif`;
      const bw = ctx.measureText(badge).width + 14;
      ctx.fillStyle = DARK + "22";
      ctx.fillRect(20, 34, bw, 18);
      ctx.fillStyle = DARK;
      ctx.fillText(badge, 27, 37);

      // Photo circle
      const photoSize = 72;
      const photoX = 20;
      const photoY = 62;
      ctx.save();
      ctx.beginPath();
      ctx.arc(photoX + photoSize / 2, photoY + photoSize / 2, photoSize / 2, 0, Math.PI * 2);
      ctx.clip();
      if (photoBase64) {
        const img = new Image();
        await new Promise<void>((res) => {
          img.onload = () => { ctx.drawImage(img, photoX, photoY, photoSize, photoSize); res(); };
          img.onerror = () => res();
          img.src = photoBase64.startsWith("data:") ? photoBase64 : `data:image/jpeg;base64,${photoBase64}`;
        });
      } else {
        ctx.fillStyle = DARK + "33";
        ctx.fillRect(photoX, photoY, photoSize, photoSize);
        ctx.fillStyle = DARK + "88";
        ctx.font = `${photoSize * 0.45}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("👤", photoX + photoSize / 2, photoY + photoSize / 2);
      }
      ctx.restore();

      // Name & role
      const textX = photoX + photoSize + 14;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = DARK;
      ctx.font = `700 22px "Philosopher", serif`;
      ctx.fillText(name.toUpperCase(), textX, photoY + 26);
      ctx.font = `500 14px "Montserrat", sans-serif`;
      ctx.fillStyle = DARK + "cc";
      ctx.fillText(role, textX, photoY + 46);

      // Flats for house helps
      if (flats && flats.length > 0) {
        ctx.font = `400 11px "Montserrat", sans-serif`;
        ctx.fillStyle = DARK + "99";
        const flatStr = flats.slice(0, 4).join("  •  ") + (flats.length > 4 ? ` +${flats.length - 4} more` : "");
        ctx.fillText(flatStr, textX, photoY + 66);
      }

      // Divider
      ctx.strokeStyle = DARK + "33";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(20, CARD_H - 40);
      ctx.lineTo(qrPanelX - 20, CARD_H - 40);
      ctx.stroke();

      // Footer
      ctx.font = `400 10px "Montserrat", sans-serif`;
      ctx.fillStyle = DARK + "88";
      ctx.fillText(APP_DOMAIN, 20, CARD_H - 20);

      // QR
      const qrCanvas = document.createElement("canvas");
      await QRCode.toCanvas(qrCanvas, qrCode, { width: QR_SIZE, margin: 1, color: { dark: GOLD, light: DARK } });
      ctx.drawImage(qrCanvas, qrPanelX, (CARD_H - QR_SIZE) / 2);

      // Scan label
      ctx.fillStyle = GOLD + "cc";
      ctx.font = `400 9px "Montserrat", sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("SCAN TO VERIFY", qrPanelX + QR_SIZE / 2, (CARD_H + QR_SIZE) / 2 + 14);
    };

    const fontsReady = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
    if (fontsReady) void fontsReady.then(render); else void render();
  }, [qrCode, name, role, category, photoBase64, societyName, flats]);

  const filename = () => {
    const base = fileBaseName?.trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ?? name.toLowerCase().replace(/\s+/g, "-");
    return `${base}-id-card.png`;
  };

  const getPng = () => canvasRef.current?.toDataURL("image/png") ?? "";

  const handleDownload = () => {
    const url = getPng(); if (!url) return;
    const a = document.createElement("a"); a.href = url; a.download = filename(); a.click();
  };

  const handleShare = async () => {
    const url = getPng(); if (!url) return;
    const blob = await fetch(url).then((r) => r.blob());
    const file = new File([blob], filename(), { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `${name} — ID Card` });
    } else {
      const shareUrl = URL.createObjectURL(blob);
      window.open(`https://wa.me/?text=${encodeURIComponent(`ID Card: ${name} — ${shareUrl}`)}`, "_blank");
    }
  };

  return (
    <div className="space-y-3">
      <canvas ref={canvasRef} className="rounded-lg shadow-md w-full max-w-[480px]" style={{ aspectRatio: `${CARD_W}/${CARD_H}` }} />
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleDownload} className="gap-1">
          <Download className="h-4 w-4" /> Download
        </Button>
        <Button variant="outline" size="sm" onClick={() => void handleShare()} className="gap-1">
          <Share2 className="h-4 w-4" /> Share
        </Button>
      </div>
    </div>
  );
};

export default StaffIdCard;
