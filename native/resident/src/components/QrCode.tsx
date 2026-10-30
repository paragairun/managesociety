import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { qrMatrix, darkRuns } from "@core/qrMatrix";
import { colors, radius, space, type } from "@/theme";

interface Props {
  /** The string a guard's scanner will read. */
  value: string;
  /** Rendered size in points, including the quiet zone. */
  size?: number;
  /** Shown under the code. */
  caption?: string;
}

/**
 * A QR code, drawn as SVG rectangles.
 *
 * The website draws these on a canvas, which React Native does not
 * have. The ENCODING is shared verbatim through @core/qrMatrix — it has
 * to be, because a guard's scanner reads the result and two different
 * encoders would eventually disagree — and only the drawing is local.
 *
 * Always dark-on-white with a white quiet zone, regardless of the dark
 * theme around it. An inverted or tinted QR is a QR that fails at a
 * gate at night, and the quiet zone is part of the spec rather than
 * padding: without it a scanner cannot find the code's edges.
 */
const QrCode = ({ value, size = 240, caption }: Props) => {
  const drawing = useMemo(() => {
    try {
      const matrix = qrMatrix(value);
      return { matrix, runs: darkRuns(matrix), error: null as string | null };
    } catch (e) {
      // Only reachable for an empty or absurdly long payload, which is a
      // bug in the caller rather than something the resident did. Shown
      // rather than crashing the screen the code sits on.
      return { matrix: null, runs: [], error: e instanceof Error ? e.message : String(e) };
    }
  }, [value]);

  if (!drawing.matrix) {
    return (
      <View style={[styles.failed, { width: size, height: size }]}>
        <Text style={styles.failedText}>This code could not be generated.</Text>
        <Text style={styles.failedDetail}>{drawing.error}</Text>
      </View>
    );
  }

  const { matrix, runs } = drawing;
  // The quiet zone is inside the declared size, so a caller asking for
  // 240 points gets a 240-point white square with the code centred in
  // it — not 240 points of code plus margin spilling over a layout.
  //
  // The viewBox is in MODULES, so the SVG scales itself and the code
  // stays crisp at any size rather than being rasterised at one.
  const span = matrix.size + matrix.margin * 2;

  return (
    <View style={styles.wrap}>
      <View style={[styles.quiet, { width: size, height: size }]}>
        <Svg width={size} height={size} viewBox={`0 0 ${span} ${span}`}>
          {/* One rect per horizontal run of dark modules rather than one
              per module: about half the elements, measured. */}
          {runs.map((run) => (
            <Rect
              key={`${run.row}-${run.col}`}
              x={run.col + matrix.margin}
              y={run.row + matrix.margin}
              width={run.length}
              height={1}
              fill={colors.qrDark}
            />
          ))}
        </Svg>
      </View>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: space.sm },
  quiet: {
    backgroundColor: colors.qrLight,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  caption: { color: colors.textMuted, fontSize: type.label, textAlign: "center" },
  failed: {
    backgroundColor: colors.dangerBg,
    borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md,
    alignItems: "center", justifyContent: "center", padding: space.lg, gap: space.xs,
  },
  failedText: { color: colors.text, fontSize: type.body, fontWeight: "700", textAlign: "center" },
  failedDetail: { color: colors.textMuted, fontSize: type.caption, textAlign: "center" },
});

export default QrCode;
