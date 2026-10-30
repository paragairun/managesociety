import { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface QrScannerProps {
  onScan: (result: string) => void;
  onClose: () => void;
}

const QrScanner = ({ onScan, onClose }: QrScannerProps) => {
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const stoppedRef = useRef(false);

  const handleClose = useCallback(() => {
    if (scannerRef.current && !stoppedRef.current) {
      stoppedRef.current = true;
      scannerRef.current.stop().catch(() => {}).finally(onClose);
    } else {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    stoppedRef.current = false;
    const scanner = new Html5Qrcode("qr-reader");
    scannerRef.current = scanner;

    scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (decodedText) => {
        if (!stoppedRef.current) {
          stoppedRef.current = true;
          scanner.stop().catch(() => {}).finally(() => onScan(decodedText));
        }
      },
      () => {}
    ).catch(() => {
      setError("Camera access denied. Please allow camera permissions.");
    });

    return () => {
      if (!stoppedRef.current) {
        stoppedRef.current = true;
        scanner.stop().catch(() => {});
      }
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95">
      <div className="w-full max-w-md p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Camera className="h-6 w-6 text-primary-ink" />
            <h2 className="text-xl font-bold text-foreground">Scan QR Code</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={handleClose} className="touch-target">
            <X className="h-6 w-6" />
          </Button>
        </div>
        <div id="qr-reader" className="w-full rounded-lg overflow-hidden border-2 border-primary/50" />
        {error && <p className="mt-4 text-center text-destructive-ink font-medium">{error}</p>}
        <p className="mt-4 text-center text-muted-foreground text-sm">Point camera at a vehicle QR sticker</p>
      </div>
    </div>
  );
};

export default QrScanner;
